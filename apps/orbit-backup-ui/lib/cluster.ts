import type {
  V1PersistentVolume,
  V1PersistentVolumeClaim,
  V1Pod,
} from "@kubernetes/client-node";

import {
  getExcludedNamespaces,
  getKubeClients,
  getLonghornNamespace,
  isKubernetesErrorStatus,
} from "@/lib/kube";
import { LonghornObject, listLonghornObjects } from "@/lib/longhorn";
import { getCloneRestoreSupportState } from "@/lib/restore";
import {
  AppInventoryItem,
  AppVolume,
  BackupEntry,
  BackupSetSummary,
  BackupTargetSummary,
  CleanupUnmanagedResponse,
  DashboardPayload,
  OverviewStats,
  UnmanagedInventoryItem,
  UnmanagedReason,
  UnmanagedResourceKind,
  WorkloadKind,
} from "@/lib/types";

type ClusterSnapshot = {
  apps: AppInventoryItem[];
  backupSets: BackupSetSummary[];
  targets: BackupTargetSummary[];
  unmanagedItems: UnmanagedInventoryItem[];
  overview: OverviewStats;
};

type WorkloadRecord = {
  kind: WorkloadKind;
  namespace: string;
  name: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  createdAt?: string;
  templateVolumes: NonNullable<V1Pod["spec"]>["volumes"];
};

type LonghornStatus = Record<string, unknown>;
type ResourceMetadata = {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};
type ArgoApplicationObject = {
  metadata?: {
    name?: string;
    namespace?: string;
  };
  spec?: {
    destination?: {
      namespace?: string;
    };
  };
  status?: {
    resources?: Array<{
      kind?: string;
      name?: string;
      namespace?: string;
    }>;
  };
};
type UnmanagedCandidate = {
  kind: UnmanagedResourceKind;
  namespace: string;
  name: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
};
type UnmanagedItemInput = {
  kind: UnmanagedResourceKind;
  namespace: string;
  name: string;
  confidence: "high" | "review";
  source: "restore-artifact" | "manual-review";
  createdAt?: string;
  managementSummary: string;
  reasons: UnmanagedReason[];
  podCount?: number;
  readyPodCount?: number;
  pods?: V1Pod[];
};

declare global {
  var __orbitClusterCache:
    | { expiresAt: number; value?: ClusterSnapshot; promise?: Promise<ClusterSnapshot> }
    | undefined;
}

const CACHE_TTL_MS = 5_000;
const ARGO_APPLICATION_GROUP = "argoproj.io";
const ARGO_APPLICATION_VERSION = "v1alpha1";
const ARGO_APPLICATION_PLURAL = "applications";
const ARGO_INSTANCE_LABELS = [
  "argocd.argoproj.io/instance",
  "app.kubernetes.io/instance",
] as const;
const ORBIT_RESTORE_LABELS = [
  "orbit.myrenic.io/restore-instance",
  "orbit.myrenic.io/restore-source",
] as const;
const CLUSTER_CRITICAL_NAMESPACES = new Set([
  "argocd",
  "auth",
  "cert-manager",
  "cilium",
  "flux-system",
  "ingress-nginx",
  "longhorn-system",
  "metallb-system",
  "network",
  "sealed-secrets",
  "storage",
  "tigera-operator",
  "traefik",
]);
const SYSTEM_RESOURCE_TOKENS = [
  "argocd",
  "coredns",
  "etcd",
  "flannel",
  "kube-apiserver",
  "kube-controller-manager",
  "kube-proxy",
  "kube-scheduler",
  "longhorn",
  "metrics-server",
  "oauth2-proxy",
  "sealed-secrets",
  "talos",
  "traefik",
] as const;

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

function getResourceDisplayName(
  namespace: string,
  kind: UnmanagedResourceKind,
  name: string,
) {
  return `${namespace}/${kind}/${name}`;
}

function getMetadataLabels(metadata?: ResourceMetadata) {
  return metadata?.labels ?? {};
}

function getMetadataAnnotations(metadata?: ResourceMetadata) {
  return metadata?.annotations ?? {};
}

function getCreationTimestamp(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  return value instanceof Date ? value.toISOString() : undefined;
}

function isClusterCriticalNamespace(
  namespace: string,
  excludedNamespaces: Set<string>,
) {
  return (
    excludedNamespaces.has(namespace) ||
    namespace.startsWith("kube-") ||
    namespace.startsWith("openshift-") ||
    namespace.endsWith("-system") ||
    namespace === getLonghornNamespace() ||
    CLUSTER_CRITICAL_NAMESPACES.has(namespace)
  );
}

function hasExplicitArgoTracking(candidate: UnmanagedCandidate) {
  return Boolean(
    candidate.annotations["argocd.argoproj.io/tracking-id"] ||
      candidate.labels["argocd.argoproj.io/instance"],
  );
}

function getArgoApplicationCandidateNames(candidate: UnmanagedCandidate) {
  const candidates = new Set<string>();

  for (const key of ARGO_INSTANCE_LABELS) {
    const value = candidate.labels[key];
    if (value) {
      candidates.add(value);
    }
  }

  const trackingId = candidate.annotations["argocd.argoproj.io/tracking-id"];
  if (trackingId) {
    const separatorIndex = trackingId.indexOf(":");
    candidates.add(separatorIndex >= 0 ? trackingId.slice(0, separatorIndex) : trackingId);
  }

  return candidates;
}

function scoreArgoApplicationMatch(
  application: ArgoApplicationObject,
  candidate: UnmanagedCandidate,
) {
  let score = 0;
  const applicationName = application.metadata?.name;
  const destinationNamespace =
    typeof application.spec?.destination?.namespace === "string"
      ? application.spec.destination.namespace
      : undefined;
  const candidateNames = getArgoApplicationCandidateNames(candidate);

  if (
    Array.isArray(application.status?.resources) &&
    application.status.resources.some(
      (resource) =>
        resource.kind === candidate.kind &&
        resource.name === candidate.name &&
        (resource.namespace || destinationNamespace || candidate.namespace) ===
          candidate.namespace,
    )
  ) {
    score = Math.max(score, 100);
  }

  if (applicationName && candidateNames.has(applicationName)) {
    score = Math.max(score, destinationNamespace === candidate.namespace ? 90 : 80);
  }

  return score;
}

function detectOwningArgoApplication(
  candidate: UnmanagedCandidate,
  argoApplications: ArgoApplicationObject[],
) {
  if (hasExplicitArgoTracking(candidate)) {
    return true;
  }

  const matches = argoApplications
    .map((application) => scoreArgoApplicationMatch(application, candidate))
    .filter((score) => score >= 80)
    .sort((left, right) => right - left);

  return matches.length > 0;
}

function isSystemLikeResource(name: string, labels: Record<string, string>) {
  const managedBy = labels["app.kubernetes.io/managed-by"]?.toLowerCase();
  if (managedBy?.includes("talos")) {
    return true;
  }

  if (labels["k8s-app"]) {
    return true;
  }

  const candidates = [
    name,
    labels["app.kubernetes.io/name"],
    labels["app.kubernetes.io/part-of"],
    labels["app.kubernetes.io/component"],
    labels["app"],
  ]
    .filter(Boolean)
    .map((value) => value.toLowerCase());

  return candidates.some((value) =>
    SYSTEM_RESOURCE_TOKENS.some((token) => value.includes(token)),
  );
}

function isRestoreNamedResource(name: string) {
  return (
    name.includes("-restore-") ||
    name.startsWith("restore-") ||
    name.endsWith("-restore") ||
    name.includes("-restored-")
  );
}

function getRestoreArtifactReason(
  name: string,
  labels: Record<string, string>,
): UnmanagedReason | undefined {
  for (const key of ORBIT_RESTORE_LABELS) {
    const value = labels[key];
    if (value) {
      return {
        summary: "Orbit restore labels detected",
        detail: `${key}=${value} marks this resource as a restore or clone artifact created outside Argo reconciliation.`,
      };
    }
  }

  if (isRestoreNamedResource(name)) {
    return {
      summary: "Restore-style resource name detected",
      detail:
        "The resource name includes a restore marker, which Orbit uses for cloned restore objects and temporary test copies.",
    };
  }

  return undefined;
}

function buildUnmanagedItem({
  kind,
  namespace,
  name,
  confidence,
  source,
  createdAt,
  managementSummary,
  reasons,
  podCount,
  readyPodCount,
  pods,
}: UnmanagedItemInput): UnmanagedInventoryItem {
  const podSummaries = (pods ?? []).map(getPodStatus);

  return {
    ref: getResourceDisplayName(namespace, kind, name),
    namespace,
    kind,
    name,
    displayName: getResourceDisplayName(namespace, kind, name),
    confidence,
    source,
    createdAt,
    managementSummary,
    reasons,
    podCount: podCount ?? podSummaries.length,
    readyPodCount: readyPodCount ?? podSummaries.filter((pod) => pod.ready).length,
    pods: podSummaries,
  };
}

async function listArgoApplicationsSafe() {
  try {
    const response = await getKubeClients().customObjects.listClusterCustomObject({
      group: ARGO_APPLICATION_GROUP,
      version: ARGO_APPLICATION_VERSION,
      plural: ARGO_APPLICATION_PLURAL,
    });

    return (response.items ?? []) as ArgoApplicationObject[];
  } catch (error) {
    if (isKubernetesErrorStatus(error, 404)) {
      return [];
    }

    throw error;
  }
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
    services,
    persistentVolumeClaims,
    persistentVolumes,
    argoApplications,
    longhornVolumes,
    longhornBackups,
    longhornBackupTargets,
  ] = await Promise.all([
    apps.listDeploymentForAllNamespaces(),
    apps.listStatefulSetForAllNamespaces(),
    apps.listDaemonSetForAllNamespaces(),
    apps.listReplicaSetForAllNamespaces(),
    core.listPodForAllNamespaces(),
    core.listServiceForAllNamespaces(),
    core.listPersistentVolumeClaimForAllNamespaces(),
    core.listPersistentVolume(),
    listArgoApplicationsSafe(),
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
      labels: getMetadataLabels(deployment.metadata),
      annotations: getMetadataAnnotations(deployment.metadata),
      createdAt: getCreationTimestamp(deployment.metadata?.creationTimestamp),
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
      labels: getMetadataLabels(statefulSet.metadata),
      annotations: getMetadataAnnotations(statefulSet.metadata),
      createdAt: getCreationTimestamp(statefulSet.metadata?.creationTimestamp),
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
      labels: getMetadataLabels(daemonSet.metadata),
      annotations: getMetadataAnnotations(daemonSet.metadata),
      createdAt: getCreationTimestamp(daemonSet.metadata?.creationTimestamp),
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
  const unmanagedItems: UnmanagedInventoryItem[] = [];

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

    if (
      isClusterCriticalNamespace(workload.namespace, excludedNamespaces) ||
      isSystemLikeResource(workload.name, workload.labels)
    ) {
      continue;
    }

    const candidate = {
      kind: workload.kind,
      namespace: workload.namespace,
      name: workload.name,
      labels: workload.labels,
      annotations: workload.annotations,
    } satisfies UnmanagedCandidate;
    if (detectOwningArgoApplication(candidate, argoApplications)) {
      continue;
    }

    const restoreArtifactReason = getRestoreArtifactReason(workload.name, workload.labels);
    unmanagedItems.push(
      buildUnmanagedItem({
        kind: workload.kind,
        namespace: workload.namespace,
        name: workload.name,
        confidence: restoreArtifactReason ? "high" : "review",
        source: restoreArtifactReason ? "restore-artifact" : "manual-review",
        createdAt: workload.createdAt,
        managementSummary: restoreArtifactReason
          ? "Orbit restore labels or restore-style naming indicate this workload is a temporary restore/test artifact outside Argo control."
          : "No Argo tracking metadata or Application ownership was detected for this top-level workload in a non-critical namespace.",
        reasons: [
          ...(restoreArtifactReason ? [restoreArtifactReason] : []),
          {
            summary: "No Argo ownership detected",
            detail:
              "Orbit did not find Argo tracking metadata or a matching Argo Application resource entry for this workload.",
          },
          {
            summary: "Safe namespace filter passed",
            detail:
              "The workload is outside cluster-critical namespaces, so it can be reviewed as a possible manual or test leftover.",
          },
        ],
        podCount: workloadPods.length,
        readyPodCount: workloadPods.filter((pod) => getPodStatus(pod).ready).length,
        pods: workloadPods,
      }),
    );
  }

  inventory.sort((left, right) => left.displayName.localeCompare(right.displayName));

  for (const pod of pods.items) {
    const namespace = pod.metadata?.namespace;
    const name = pod.metadata?.name;
    const labels = getMetadataLabels(pod.metadata);
    const annotations = getMetadataAnnotations(pod.metadata);
    if (
      !namespace ||
      !name ||
      pod.metadata?.ownerReferences?.length ||
      isClusterCriticalNamespace(namespace, excludedNamespaces) ||
      isSystemLikeResource(name, labels)
    ) {
      continue;
    }

    const candidate = {
      kind: "Pod",
      namespace,
      name,
      labels,
      annotations,
    } satisfies UnmanagedCandidate;
    if (detectOwningArgoApplication(candidate, argoApplications)) {
      continue;
    }

    const restoreArtifactReason = getRestoreArtifactReason(name, labels);
    unmanagedItems.push(
      buildUnmanagedItem({
        kind: "Pod",
        namespace,
        name,
        confidence: restoreArtifactReason ? "high" : "review",
        source: restoreArtifactReason ? "restore-artifact" : "manual-review",
        createdAt: getCreationTimestamp(pod.metadata?.creationTimestamp),
        managementSummary: restoreArtifactReason
          ? "Orbit restore labels or restore-style naming indicate this pod is part of a restore/test flow outside Argo control."
          : "This pod has no owning controller and no Argo ownership markers, so Orbit surfaced it for manual review.",
        reasons: [
          ...(restoreArtifactReason ? [restoreArtifactReason] : []),
          {
            summary: "Standalone pod",
            detail:
              "The pod has no owning controller reference, which makes it a higher-signal candidate for manual cleanup review.",
          },
          {
            summary: "No Argo ownership detected",
            detail:
              "Orbit did not find Argo tracking metadata or a matching Argo Application resource entry for this pod.",
          },
        ],
        pods: [pod],
      }),
    );
  }

  for (const service of services.items) {
    const namespace = service.metadata?.namespace;
    const name = service.metadata?.name;
    const labels = getMetadataLabels(service.metadata);
    const annotations = getMetadataAnnotations(service.metadata);
    const restoreArtifactReason = name ? getRestoreArtifactReason(name, labels) : undefined;
    if (
      !namespace ||
      !name ||
      !restoreArtifactReason ||
      isClusterCriticalNamespace(namespace, excludedNamespaces) ||
      isSystemLikeResource(name, labels)
    ) {
      continue;
    }

    const candidate = {
      kind: "Service",
      namespace,
      name,
      labels,
      annotations,
    } satisfies UnmanagedCandidate;
    if (detectOwningArgoApplication(candidate, argoApplications)) {
      continue;
    }

    unmanagedItems.push(
      buildUnmanagedItem({
        kind: "Service",
        namespace,
        name,
        confidence: "high",
        source: "restore-artifact",
        createdAt: getCreationTimestamp(service.metadata?.creationTimestamp),
        managementSummary:
          "Orbit surfaced this Service because restore signals indicate it belongs to a temporary restore/test copy outside Argo control.",
        reasons: [
          restoreArtifactReason,
          {
            summary: "No Argo ownership detected",
            detail:
              "Orbit did not find Argo tracking metadata or a matching Argo Application resource entry for this Service.",
          },
        ],
      }),
    );
  }

  for (const persistentVolumeClaim of persistentVolumeClaims.items) {
    const namespace = persistentVolumeClaim.metadata?.namespace;
    const name = persistentVolumeClaim.metadata?.name;
    const labels = getMetadataLabels(persistentVolumeClaim.metadata);
    const annotations = getMetadataAnnotations(persistentVolumeClaim.metadata);
    const restoreArtifactReason = name ? getRestoreArtifactReason(name, labels) : undefined;
    if (
      !namespace ||
      !name ||
      !restoreArtifactReason ||
      isClusterCriticalNamespace(namespace, excludedNamespaces) ||
      isSystemLikeResource(name, labels)
    ) {
      continue;
    }

    const candidate = {
      kind: "PersistentVolumeClaim",
      namespace,
      name,
      labels,
      annotations,
    } satisfies UnmanagedCandidate;
    if (detectOwningArgoApplication(candidate, argoApplications)) {
      continue;
    }

    unmanagedItems.push(
      buildUnmanagedItem({
        kind: "PersistentVolumeClaim",
        namespace,
        name,
        confidence: "high",
        source: "restore-artifact",
        createdAt: getCreationTimestamp(persistentVolumeClaim.metadata?.creationTimestamp),
        managementSummary:
          "Orbit surfaced this PVC because restore signals indicate it was created for a cloned restore/test flow outside Argo control.",
        reasons: [
          restoreArtifactReason,
          {
            summary: "No Argo ownership detected",
            detail:
              "Orbit did not find Argo tracking metadata or a matching Argo Application resource entry for this PVC.",
          },
        ],
      }),
    );
  }

  unmanagedItems.sort((left, right) => left.displayName.localeCompare(right.displayName));

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
      ? status.conditions
        .map((condition) => {
          const conditionObject = condition as Record<string, unknown>;
          const conditionStatus =
            typeof conditionObject.status === "string" ? conditionObject.status : undefined;
          if (conditionStatus === "False") {
            return undefined;
          }

          const message = [
            conditionObject.type,
            conditionObject.reason,
            conditionObject.message,
          ]
            .filter(Boolean)
            .join(": ");

          return message || undefined;
        })
        .filter((condition): condition is string => Boolean(condition))
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
    unmanagedItems,
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

export async function getUnmanagedInventory() {
  return (await getClusterSnapshot()).unmanagedItems;
}

async function deleteUnmanagedResource(item: UnmanagedInventoryItem) {
  const { apps, core } = getKubeClients();

  try {
    switch (item.kind) {
      case "Deployment":
        await apps.deleteNamespacedDeployment({
          namespace: item.namespace,
          name: item.name,
        });
        return;
      case "StatefulSet":
        await apps.deleteNamespacedStatefulSet({
          namespace: item.namespace,
          name: item.name,
        });
        return;
      case "DaemonSet":
        await apps.deleteNamespacedDaemonSet({
          namespace: item.namespace,
          name: item.name,
        });
        return;
      case "Pod":
        await core.deleteNamespacedPod({
          namespace: item.namespace,
          name: item.name,
        });
        return;
      case "Service":
        await core.deleteNamespacedService({
          namespace: item.namespace,
          name: item.name,
        });
        return;
      case "PersistentVolumeClaim":
        await core.deleteNamespacedPersistentVolumeClaim({
          namespace: item.namespace,
          name: item.name,
        });
        return;
      default: {
        const exhaustive: never = item.kind;
        throw new Error(`Cleanup is not supported for ${exhaustive}.`);
      }
    }
  } catch (error) {
    if (isKubernetesErrorStatus(error, 404)) {
      return;
    }

    throw error;
  }
}

export async function cleanupUnmanagedInventory(
  refs: string[],
): Promise<CleanupUnmanagedResponse> {
  const uniqueRefs = [...new Set(refs.filter(Boolean))];
  if (uniqueRefs.length === 0) {
    throw new Error("Select at least one high-confidence unmanaged item to clean up.");
  }

  const snapshot = await getClusterSnapshot(true);
  const itemsByRef = new Map(snapshot.unmanagedItems.map((item) => [item.ref, item]));
  const result: CleanupUnmanagedResponse = {
    deleted: [],
    skipped: [],
  };

  for (const ref of uniqueRefs) {
    const item = itemsByRef.get(ref);
    if (!item) {
      result.skipped.push({
        ref,
        displayName: ref,
        reason:
          "This item is no longer in Orbit's unmanaged inventory. Refresh and try again.",
      });
      continue;
    }

    if (item.confidence !== "high") {
      result.skipped.push({
        ref,
        displayName: item.displayName,
        reason:
          "Only high-confidence restore/test artifacts can be cleaned up from the UI. Review-only items stay visibility-only.",
      });
      continue;
    }

    try {
      await deleteUnmanagedResource(item);
      result.deleted.push({
        ref: item.ref,
        displayName: item.displayName,
      });
    } catch (error) {
      result.skipped.push({
        ref: item.ref,
        displayName: item.displayName,
        reason:
          error instanceof Error
            ? error.message
            : "Cleanup failed for this resource.",
      });
    }
  }

  invalidateClusterSnapshot();
  return result;
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
