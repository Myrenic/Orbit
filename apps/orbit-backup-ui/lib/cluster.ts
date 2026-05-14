import type {
  V1PersistentVolume,
  V1PersistentVolumeClaim,
  V1Pod,
} from "@kubernetes/client-node";

import { getExcludedNamespaces, getKubeClients } from "@/lib/kube";
import { LonghornObject, listLonghornObjects } from "@/lib/longhorn";
import { getCloneRestoreSupportState } from "@/lib/restore";
import {
  AppInventoryItem,
  AppVolume,
  BackupEntry,
  BackupSetSummary,
  BackupTargetSummary,
  DashboardPayload,
  OverviewStats,
  WorkloadKind,
} from "@/lib/types";

type ClusterSnapshot = {
  apps: AppInventoryItem[];
  backupSets: BackupSetSummary[];
  targets: BackupTargetSummary[];
  overview: OverviewStats;
};

type WorkloadRecord = {
  kind: WorkloadKind;
  namespace: string;
  name: string;
  templateVolumes: NonNullable<V1Pod["spec"]>["volumes"];
};

type LonghornStatus = Record<string, unknown>;

declare global {
  var __orbitClusterCache:
    | { expiresAt: number; value?: ClusterSnapshot; promise?: Promise<ClusterSnapshot> }
    | undefined;
}

const CACHE_TTL_MS = 5_000;

function getControllerRef(kind: WorkloadKind, namespace: string, name: string) {
  return `${namespace}/${kind}/${name}`;
}

function getWorkloadDisplayName(namespace: string, kind: WorkloadKind, name: string) {
  return `${namespace}/${kind}/${name}`;
}

function getWorkloadRef(
  namespace?: string,
  kind?: WorkloadKind,
  name?: string,
): string | undefined {
  if (!namespace || !kind || !name) {
    return undefined;
  }

  return getControllerRef(kind, namespace, name);
}

function getLonghornLabel(
  labels: Record<string, string>,
  key: string,
): string | undefined {
  return labels[key] || labels[`orbit.${key}`];
}

function getPodStatus(pod: V1Pod) {
  const statuses = pod.status?.containerStatuses ?? [];
  const ready =
    statuses.length > 0 && statuses.every((containerStatus) => containerStatus.ready);
  const restarts = statuses.reduce(
    (total, containerStatus) => total + containerStatus.restartCount,
    0,
  );

  return {
    name: pod.metadata?.name || "pod",
    phase: pod.status?.phase || "Unknown",
    ready,
    restarts,
  };
}

function getBackupSetState(entries: BackupEntry[]) {
  if (entries.some((entry) => entry.state === "Error")) {
    return "Error";
  }

  if (entries.some((entry) => entry.state === "InProgress")) {
    return "InProgress";
  }

  if (entries.every((entry) => entry.state === "Completed")) {
    return "Completed";
  }

  return entries[0]?.state || "Unknown";
}

function getScheduledBackupSetId(
  scheduleId: string,
  appRef: string | undefined,
  volumeName: string,
  createdAt?: string,
) {
  const bucket = (createdAt || "unknown").slice(0, 16) || "unknown";
  return `schedule:${scheduleId}:${appRef || volumeName || "unknown"}:${bucket}`;
}

function extractVolumeInfo(
  pvc: V1PersistentVolumeClaim | undefined,
  pv: V1PersistentVolume | undefined,
  longhornVolume: LonghornObject | undefined,
): AppVolume | undefined {
  if (!pvc || !pv) {
    return undefined;
  }

  const csiVolume = pv.spec?.csi;
  const longhornVolumeName =
    csiVolume?.volumeHandle ||
    String(
      (longhornVolume?.status as LonghornStatus | undefined)?.kubernetesStatus &&
        ((longhornVolume?.status as LonghornStatus).kubernetesStatus as Record<
          string,
          unknown
        >).pvName,
    );

  if (!longhornVolumeName || longhornVolumeName === "undefined") {
    return undefined;
  }

  const accessModes = pvc.spec?.accessModes ?? [];
  const volumeStatus = longhornVolume?.status as LonghornStatus | undefined;
  const volumeSpec = longhornVolume?.spec as Record<string, unknown> | undefined;

  return {
    pvcName: pvc.metadata?.name || "claim",
    pvName: pv.metadata?.name,
    longhornVolumeName,
    size: pvc.status?.capacity?.storage ?? pvc.spec?.resources?.requests?.storage,
    accessModes,
    longhornAccessMode:
      typeof volumeSpec?.accessMode === "string" ? volumeSpec.accessMode : undefined,
    storageClassName: pvc.spec?.storageClassName ?? undefined,
    fsType:
      typeof csiVolume?.fsType === "string" && csiVolume.fsType
        ? csiVolume.fsType
        : undefined,
    numberOfReplicas:
      typeof volumeSpec?.numberOfReplicas === "number"
        ? volumeSpec.numberOfReplicas
        : undefined,
    frontend:
      typeof volumeSpec?.frontend === "string" ? volumeSpec.frontend : undefined,
    dataEngine:
      typeof volumeSpec?.dataEngine === "string" ? volumeSpec.dataEngine : undefined,
    lastBackup:
      typeof volumeStatus?.lastBackup === "string" ? volumeStatus.lastBackup : undefined,
    lastBackupAt:
      typeof volumeStatus?.lastBackupAt === "string"
        ? volumeStatus.lastBackupAt
        : undefined,
  };
}

function getAppStatus(podCount: number, readyCount: number) {
  if (podCount === 0) {
    return "stopped" as const;
  }

  return podCount === readyCount ? ("healthy" as const) : ("degraded" as const);
}

async function loadClusterSnapshot(): Promise<ClusterSnapshot> {
  const { apps, core } = getKubeClients();
  const excludedNamespaces = getExcludedNamespaces();

  const [
    deployments,
    statefulSets,
    daemonSets,
    replicaSets,
    pods,
    persistentVolumeClaims,
    persistentVolumes,
    longhornVolumes,
    longhornBackups,
    longhornBackupTargets,
  ] = await Promise.all([
    apps.listDeploymentForAllNamespaces(),
    apps.listStatefulSetForAllNamespaces(),
    apps.listDaemonSetForAllNamespaces(),
    apps.listReplicaSetForAllNamespaces(),
    core.listPodForAllNamespaces(),
    core.listPersistentVolumeClaimForAllNamespaces(),
    core.listPersistentVolume(),
    listLonghornObjects("volumes"),
    listLonghornObjects("backups"),
    listLonghornObjects("backuptargets"),
  ]);

  const workloadRecords = new Map<string, WorkloadRecord>();

  for (const deployment of deployments.items) {
    const namespace = deployment.metadata?.namespace;
    const name = deployment.metadata?.name;
    if (!namespace || !name || excludedNamespaces.has(namespace)) {
      continue;
    }

    workloadRecords.set(getControllerRef("Deployment", namespace, name), {
      kind: "Deployment",
      namespace,
      name,
      templateVolumes: deployment.spec?.template?.spec?.volumes,
    });
  }

  for (const statefulSet of statefulSets.items) {
    const namespace = statefulSet.metadata?.namespace;
    const name = statefulSet.metadata?.name;
    if (!namespace || !name || excludedNamespaces.has(namespace)) {
      continue;
    }

    workloadRecords.set(getControllerRef("StatefulSet", namespace, name), {
      kind: "StatefulSet",
      namespace,
      name,
      templateVolumes: statefulSet.spec?.template?.spec?.volumes,
    });
  }

  for (const daemonSet of daemonSets.items) {
    const namespace = daemonSet.metadata?.namespace;
    const name = daemonSet.metadata?.name;
    if (!namespace || !name || excludedNamespaces.has(namespace)) {
      continue;
    }

    workloadRecords.set(getControllerRef("DaemonSet", namespace, name), {
      kind: "DaemonSet",
      namespace,
      name,
      templateVolumes: daemonSet.spec?.template?.spec?.volumes,
    });
  }

  const replicaSetOwners = new Map<string, string>();
  for (const replicaSet of replicaSets.items) {
    const namespace = replicaSet.metadata?.namespace;
    const name = replicaSet.metadata?.name;
    const owner = replicaSet.metadata?.ownerReferences?.find(
      (reference) => reference.kind === "Deployment" && reference.name,
    );
    if (namespace && name && owner?.name) {
      replicaSetOwners.set(
        `${namespace}/${name}`,
        getControllerRef("Deployment", namespace, owner.name),
      );
    }
  }

  const podsByWorkload = new Map<string, V1Pod[]>();
  for (const pod of pods.items) {
    const namespace = pod.metadata?.namespace;
    const owner = pod.metadata?.ownerReferences?.[0];
    if (!namespace || excludedNamespaces.has(namespace) || !owner?.name) {
      continue;
    }

    let key: string | undefined;

    if (owner.kind === "ReplicaSet") {
      key = replicaSetOwners.get(`${namespace}/${owner.name}`);
    } else if (
      owner.kind === "StatefulSet" ||
      owner.kind === "DaemonSet"
    ) {
      key = getControllerRef(owner.kind as WorkloadKind, namespace, owner.name);
    }

    if (!key || !workloadRecords.has(key)) {
      continue;
    }

    const workloadPods = podsByWorkload.get(key) ?? [];
    workloadPods.push(pod);
    podsByWorkload.set(key, workloadPods);
  }

  const pvcMap = new Map(
    persistentVolumeClaims.items.map((persistentVolumeClaim) => [
      `${persistentVolumeClaim.metadata?.namespace}/${persistentVolumeClaim.metadata?.name}`,
      persistentVolumeClaim,
    ]),
  );

  const pvMap = new Map(
    persistentVolumes.items.map((persistentVolume) => [
      persistentVolume.metadata?.name ?? "",
      persistentVolume,
    ]),
  );

  const longhornVolumeMap = new Map(
    longhornVolumes.map((volume) => [volume.metadata?.name ?? "", volume]),
  );

  const inventory: AppInventoryItem[] = [];

  for (const [ref, workload] of workloadRecords.entries()) {
    const workloadPods = podsByWorkload.get(ref) ?? [];
    const templateClaims = new Set<string>();

    for (const volume of workload.templateVolumes ?? []) {
      if (volume.persistentVolumeClaim?.claimName) {
        templateClaims.add(volume.persistentVolumeClaim.claimName);
      }
    }

    for (const pod of workloadPods) {
      for (const volume of pod.spec?.volumes ?? []) {
        if (volume.persistentVolumeClaim?.claimName) {
          templateClaims.add(volume.persistentVolumeClaim.claimName);
        }
      }
    }

    const claimNames = [...templateClaims].sort();
    const appVolumes = claimNames
      .map((claimName) => {
        const pvc = pvcMap.get(`${workload.namespace}/${claimName}`);
        const pvName = pvc?.spec?.volumeName;
        const pv = pvName ? pvMap.get(pvName) : undefined;
        const longhornVolumeName =
          pv?.spec?.csi?.volumeHandle ||
          String(
            (
              longhornVolumes.find((candidate) => {
                const kubernetesStatus = candidate.status?.kubernetesStatus as
                  | Record<string, unknown>
                  | undefined;
                return (
                  kubernetesStatus?.namespace === workload.namespace &&
                  kubernetesStatus?.pvcName === claimName
                );
              })?.metadata?.name ?? ""
            ),
          );
        const longhornVolume = longhornVolumeMap.get(longhornVolumeName);
        return extractVolumeInfo(pvc, pv, longhornVolume);
      })
      .filter((volume): volume is AppVolume => Boolean(volume));

    const podSummaries = workloadPods.map(getPodStatus);
    const readyPodCount = podSummaries.filter((pod) => pod.ready).length;

    inventory.push({
      ref,
      namespace: workload.namespace,
      kind: workload.kind,
      name: workload.name,
      displayName: getWorkloadDisplayName(
        workload.namespace,
        workload.kind,
        workload.name,
      ),
      status: getAppStatus(workloadPods.length, readyPodCount),
      podCount: workloadPods.length,
      readyPodCount,
      podNames: workloadPods
        .map((pod) => pod.metadata?.name)
        .filter((name): name is string => Boolean(name)),
      pods: podSummaries,
      claimNames,
      volumes: appVolumes,
    });
  }

  inventory.sort((left, right) => left.displayName.localeCompare(right.displayName));

  const appByRef = new Map(inventory.map((app) => [app.ref, app]));
  const appRefByVolumeName = new Map<string, string>();
  for (const app of inventory) {
    for (const volume of app.volumes) {
      appRefByVolumeName.set(volume.longhornVolumeName, app.ref);
    }
  }

  const backupEntries: BackupEntry[] = longhornBackups.map((backup) => {
    const status = (backup.status ?? {}) as Record<string, unknown>;
    const spec = (backup.spec ?? {}) as Record<string, unknown>;
    const labels = ((status.labels ?? spec.labels ?? {}) as Record<string, string>) || {};
    const operationId = getLonghornLabel(labels, "operation");
    const itemId = getLonghornLabel(labels, "item");
    const scheduleId = getLonghornLabel(labels, "schedule-id");
    const labeledWorkloadKind = getLonghornLabel(labels, "kind");
    const workloadKind =
      labeledWorkloadKind === "Deployment" ||
      labeledWorkloadKind === "StatefulSet" ||
      labeledWorkloadKind === "DaemonSet"
        ? labeledWorkloadKind
        : undefined;
    const workloadRef = getWorkloadRef(
      getLonghornLabel(labels, "namespace"),
      workloadKind,
      getLonghornLabel(labels, "workload"),
    );
    const matchedAppRef = [
      getLonghornLabel(labels, "app-ref"),
      workloadRef,
      appRefByVolumeName.get(String(status.volumeName ?? "")),
    ].find((candidate): candidate is string => Boolean(candidate));
    const matchedApp = matchedAppRef ? appByRef.get(matchedAppRef) : undefined;
    const currentAppRef = matchedApp?.ref ?? matchedAppRef;
    const createdAt =
      typeof status.backupCreatedAt === "string" ? status.backupCreatedAt : undefined;
    const setId = operationId && itemId
      ? `${operationId}:${itemId}`
      : scheduleId
        ? getScheduledBackupSetId(
            scheduleId,
            currentAppRef,
            String(status.volumeName ?? ""),
            createdAt || backup.metadata?.creationTimestamp,
          )
        : `backup:${backup.metadata?.name ?? "unknown"}`;

    return {
      name: backup.metadata?.name ?? "backup",
      setId,
      volumeName: String(status.volumeName ?? ""),
      pvcName: getLonghornLabel(labels, "pvc"),
      namespace: getLonghornLabel(labels, "namespace") || matchedApp?.namespace,
      workloadKind: workloadKind ?? matchedApp?.kind,
      workloadName: getLonghornLabel(labels, "workload") || matchedApp?.name,
      appDisplayName:
        getLonghornLabel(labels, "display") ||
        matchedApp?.displayName ||
        currentAppRef ||
        String(status.volumeName ?? "Backup"),
      currentAppRef,
      createdAt,
      state: typeof status.state === "string" ? status.state : "Unknown",
      progress:
        typeof status.progress === "number"
          ? status.progress
          : Number(status.progress ?? 0) || 0,
      url: typeof status.url === "string" ? status.url : undefined,
      volumeSize:
        typeof status.volumeSize === "string" ? status.volumeSize : undefined,
      snapshotName:
        typeof status.snapshotName === "string" ? status.snapshotName : undefined,
      requestedBy: getLonghornLabel(labels, "requested-by"),
      labels,
    };
  });

  backupEntries.sort((left, right) =>
    (right.createdAt || "").localeCompare(left.createdAt || ""),
  );

  const groupedBackups = new Map<string, BackupEntry[]>();
  for (const entry of backupEntries) {
    const group = groupedBackups.get(entry.setId) ?? [];
    group.push(entry);
    groupedBackups.set(entry.setId, group);
  }

  const backupSets: BackupSetSummary[] = [...groupedBackups.entries()].map(
    ([id, entries]) => {
      const latestEntry = [...entries].sort((left, right) =>
        (right.createdAt || "").localeCompare(left.createdAt || ""),
      )[0];
      const sortedEntries = entries.sort((left, right) =>
        left.volumeName.localeCompare(right.volumeName),
      );
      const currentApp = entries
        .map((entry) => (entry.currentAppRef ? appByRef.get(entry.currentAppRef) : undefined))
        .find((entry): entry is AppInventoryItem => Boolean(entry));
      const cloneRestoreState = getCloneRestoreSupportState({
        displayName:
          currentApp?.displayName ||
          latestEntry?.appDisplayName ||
          latestEntry?.currentAppRef ||
          latestEntry?.volumeName ||
          id,
        namespace: latestEntry?.namespace || currentApp?.namespace,
        workloadKind: latestEntry?.workloadKind || currentApp?.kind,
        workloadName: latestEntry?.workloadName || currentApp?.name,
        volumes: sortedEntries,
      });

      return {
        id,
        displayName:
          currentApp?.displayName ||
          latestEntry?.appDisplayName ||
          latestEntry?.currentAppRef ||
          latestEntry?.volumeName ||
          id,
        namespace: latestEntry?.namespace || currentApp?.namespace,
        workloadKind: latestEntry?.workloadKind || currentApp?.kind,
        workloadName: latestEntry?.workloadName || currentApp?.name,
        currentAppRef: latestEntry?.currentAppRef || currentApp?.ref,
        createdAt: latestEntry?.createdAt,
        state: getBackupSetState(entries),
        volumeCount: entries.length,
        requestedBy: latestEntry?.requestedBy,
        podCount: currentApp?.podCount ?? 0,
        readyPodCount: currentApp?.readyPodCount ?? 0,
        podNames: currentApp?.podNames ?? [],
        pods: currentApp?.pods ?? [],
        cloneRestoreSupported: cloneRestoreState.supported,
        cloneRestoreBlockedReason: cloneRestoreState.blockedReason,
        volumes: sortedEntries,
      };
    },
  );

  backupSets.sort((left, right) =>
    (right.createdAt || "").localeCompare(left.createdAt || ""),
  );

  const targets: BackupTargetSummary[] = longhornBackupTargets.map((target) => {
    const status = (target.status ?? {}) as Record<string, unknown>;
    const conditions = Array.isArray(status.conditions)
      ? status.conditions.map((condition) => {
          const conditionObject = condition as Record<string, unknown>;
          return [
            conditionObject.type,
            conditionObject.reason,
            conditionObject.message,
          ]
            .filter(Boolean)
            .join(": ");
        })
      : [];

    return {
      name: target.metadata?.name ?? "default",
      backupTargetURL:
        typeof target.spec?.backupTargetURL === "string"
          ? target.spec.backupTargetURL
          : undefined,
      credentialSecret:
        typeof target.spec?.credentialSecret === "string"
          ? target.spec.credentialSecret
          : undefined,
      pollInterval:
        typeof target.spec?.pollInterval === "string"
          ? target.spec.pollInterval
          : undefined,
      available: Boolean(status.available),
      lastSyncedAt:
        typeof status.lastSyncedAt === "string" ? status.lastSyncedAt : undefined,
      conditions,
    };
  });

  targets.sort((left, right) => left.name.localeCompare(right.name));

  const overview: OverviewStats = {
    workloadCount: inventory.length,
    protectedWorkloadCount: inventory.filter((item) => item.volumes.length > 0).length,
    backupSetCount: backupSets.length,
    runningOperations: 0,
    targetHealthy: targets.some((target) => target.available),
  };

  return {
    apps: inventory,
    backupSets,
    targets,
    overview,
  };
}

export async function getClusterSnapshot(forceRefresh = false) {
  const cache = globalThis.__orbitClusterCache;

  if (!forceRefresh && cache?.value && cache.expiresAt > Date.now()) {
    return cache.value;
  }

  if (!forceRefresh && cache?.promise) {
    return cache.promise;
  }

  const promise = loadClusterSnapshot();
  globalThis.__orbitClusterCache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    promise,
  };

  try {
    const value = await promise;
    globalThis.__orbitClusterCache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value,
    };
    return value;
  } catch (error) {
    if (globalThis.__orbitClusterCache?.promise === promise) {
      globalThis.__orbitClusterCache = undefined;
    }
    throw error;
  }
}

export function invalidateClusterSnapshot() {
  globalThis.__orbitClusterCache = undefined;
}

export async function getInventory() {
  return (await getClusterSnapshot()).apps;
}

export async function getBackupSets() {
  return (await getClusterSnapshot()).backupSets;
}

export async function getBackupTargets() {
  return (await getClusterSnapshot()).targets;
}

export async function buildDashboard(
  recentOperationsCount: number,
  runningOperations: number,
  schedulesCount: number,
) {
  const snapshot = await getClusterSnapshot();
  const overview: OverviewStats = {
    ...snapshot.overview,
    runningOperations,
  };

  const payload: Pick<DashboardPayload, "overview" | "targets"> & {
    schedulesCount: number;
    recentOperationsCount: number;
  } = {
    overview,
    targets: snapshot.targets,
    schedulesCount,
    recentOperationsCount,
  };

  return payload;
}
