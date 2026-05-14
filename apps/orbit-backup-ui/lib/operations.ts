import type {
  V1Deployment,
  V1Namespace,
  V1Pod,
  V1PersistentVolume,
  V1PersistentVolumeClaim,
  V1Service,
  V1StatefulSet,
} from "@kubernetes/client-node";
import { Cron } from "croner";

import { getKubeClients, isKubernetesErrorStatus } from "@/lib/kube";
import {
  createLonghornObject,
  deleteLonghornObject,
  getLonghornObject,
  listLonghornObjects,
  LonghornObject,
  replaceLonghornObject,
  waitForLonghornObject,
} from "@/lib/longhorn";
import { getClusterSnapshot, invalidateClusterSnapshot } from "@/lib/cluster";
import {
  getCloneRestoreValidationError,
  getInPlaceRestoreValidationError,
  resolveRestoreTargetNamespace,
} from "@/lib/restore";
import {
  AppInventoryItem,
  BackupMode,
  BackupSetSummary,
  CreateOperationRequest,
  DeleteScheduleRequest,
  OperationItem,
  OperationItemStatus,
  OperationRecord,
  OperationStatus,
  ScheduleDefinition,
  UpdateScheduleRequest,
} from "@/lib/types";
import {
  deleteSchedule as deletePersistedSchedule,
  listOperations,
  listSchedules as listPersistedSchedules,
  patchOperation,
  upsertOperation,
} from "@/lib/store";

function now() {
  return new Date().toISOString();
}

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}

function buildName(...segments: string[]) {
  const value = segments
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return value.slice(0, 63).replace(/-$/, "") || `orbit-${shortId()}`;
}

function getNextRunAt(cronExpression: string) {
  return new Cron(cronExpression, { paused: true }).nextRun()?.toISOString();
}

function getNextRunAtSafe(cronExpression: string) {
  try {
    return getNextRunAt(cronExpression);
  } catch {
    return undefined;
  }
}

const ORBIT_MANAGED_BY_LABEL = "app.kubernetes.io/managed-by";
const ARGO_APPLICATION_GROUP = "argoproj.io";
const ARGO_APPLICATION_VERSION = "v1alpha1";
const ARGO_APPLICATION_PLURAL = "applications";
const ARGO_REFRESH_ANNOTATION = "argocd.argoproj.io/refresh";
const ARGO_SKIP_RECONCILE_ANNOTATION = "argocd.argoproj.io/skip-reconcile";
const ARGO_INSTANCE_LABELS = [
  "argocd.argoproj.io/instance",
  "app.kubernetes.io/instance",
] as const;
const EPHEMERAL_PVC_ANNOTATIONS = new Set([
  "pv.kubernetes.io/bind-completed",
  "pv.kubernetes.io/bound-by-controller",
  "volume.kubernetes.io/storage-provisioner",
  "volume.beta.kubernetes.io/storage-provisioner",
  "volume.kubernetes.io/selected-node",
]);

function sanitizeLabelValue(value: string, maxLength = 63) {
  const normalized = value
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/[^A-Za-z0-9]+$/, "");

  return normalized.slice(0, maxLength).replace(/[^A-Za-z0-9]+$/, "");
}

function buildRestoreSourceLabelValue(namespace?: string, name?: string) {
  return sanitizeLabelValue([namespace, name].filter(Boolean).join(".")) || "restore";
}
const ORBIT_MANAGED_BY_VALUE = "orbit-backup-ui";
const ORBIT_SCHEDULE_MARKER_LABEL = "orbit.myrenic.io/managed-schedule";
const ORBIT_SCHEDULE_NAME_ANNOTATION = "orbit.myrenic.io/schedule-name";
const ORBIT_SCHEDULE_APP_REFS_ANNOTATION = "orbit.myrenic.io/schedule-app-refs";
const ORBIT_SCHEDULE_ENABLED_ANNOTATION = "orbit.myrenic.io/schedule-enabled";
const ORBIT_SCHEDULE_CREATED_AT_ANNOTATION = "orbit.myrenic.io/schedule-created-at";
const ORBIT_SCHEDULE_UPDATED_AT_ANNOTATION = "orbit.myrenic.io/schedule-updated-at";
const ORBIT_SCHEDULE_LAST_RUN_AT_ANNOTATION = "orbit.myrenic.io/schedule-last-run-at";
const LONGHORN_RECURRING_JOB_LABEL_PREFIX = "recurring-job.longhorn.io/";
const RECURRING_JOB_RETAIN = 7;
const RECURRING_JOB_CONCURRENCY = 1;

function buildRecurringJobName(name: string) {
  return buildName(name, shortId()).slice(0, 40);
}

function getRecurringJobAssignmentLabel(scheduleId: string) {
  return `${LONGHORN_RECURRING_JOB_LABEL_PREFIX}${scheduleId}`;
}

function getLonghornObjectLabels(object: LonghornObject) {
  return object.metadata?.labels ?? {};
}

function getLonghornObjectAnnotations(object: LonghornObject) {
  return object.metadata?.annotations ?? {};
}

function getBooleanAnnotation(value?: string) {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
}

function parseScheduleAppRefs(value?: string) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  } catch {
    return [];
  }
}

function getPositiveInteger(value: unknown, fallback: number) {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(numericValue) && numericValue >= 1 ? numericValue : fallback;
}

function getResolvedScheduleVolumeNames(apps: AppInventoryItem[], appRefs: string[]) {
  const appRefsSet = new Set(appRefs);
  const volumeNames = new Set<string>();

  for (const app of apps) {
    if (!appRefsSet.has(app.ref)) {
      continue;
    }

    for (const volume of app.volumes) {
      volumeNames.add(volume.longhornVolumeName);
    }
  }

  return volumeNames;
}

function buildScheduleAnnotations(schedule: {
  name: string;
  appRefs: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}) {
  return {
    [ORBIT_SCHEDULE_NAME_ANNOTATION]: schedule.name,
    [ORBIT_SCHEDULE_APP_REFS_ANNOTATION]: JSON.stringify(schedule.appRefs),
    [ORBIT_SCHEDULE_ENABLED_ANNOTATION]: String(schedule.enabled),
    [ORBIT_SCHEDULE_CREATED_AT_ANNOTATION]: schedule.createdAt,
    [ORBIT_SCHEDULE_UPDATED_AT_ANNOTATION]: schedule.updatedAt,
    ...(schedule.lastRunAt
      ? {
          [ORBIT_SCHEDULE_LAST_RUN_AT_ANNOTATION]: schedule.lastRunAt,
        }
      : {}),
  };
}

function buildRecurringJobBackupLabels(scheduleId: string, scheduleName: string) {
  return {
    "orbit-schedule-id": scheduleId,
    "orbit-schedule-name": scheduleName,
    "orbit-requested-by": `schedule:${scheduleName}`,
  };
}

function isOrbitManagedSchedule(object: LonghornObject) {
  return getLonghornObjectLabels(object)[ORBIT_SCHEDULE_MARKER_LABEL] === "true";
}

function getOperationSummary(request: CreateOperationRequest) {
  if (request.type === "backup") {
    return `Backup ${request.appRefs.length} workload${
      request.appRefs.length === 1 ? "" : "s"
    }`;
  }

  return `Restore ${request.backupSetIds.length} backup set${
    request.backupSetIds.length === 1 ? "" : "s"
  }`;
}

async function updateItem(
  operationId: string,
  itemId: string,
  updater: (item: OperationItem) => void,
) {
  await patchOperation(operationId, (operation) => {
    const item = operation.items.find((entry) => entry.id === itemId);
    if (!item) {
      throw new Error(`Operation item ${itemId} no longer exists.`);
    }
    updater(item);
    operation.status = deriveOperationStatus(operation.items, operation.status);
  });
}

function deriveOperationStatus(
  items: OperationItem[],
  currentStatus: OperationStatus,
): OperationStatus {
  if (items.some((item) => item.status === "running")) {
    return "running";
  }

  if (items.every((item) => item.status === "succeeded" || item.status === "skipped")) {
    return currentStatus === "queued" ? "queued" : "succeeded";
  }

  if (items.some((item) => item.status === "failed")) {
    return currentStatus === "running" ? "running" : "failed";
  }

  return currentStatus;
}

function isFinalItemStatus(status: OperationItemStatus) {
  return status === "failed" || status === "skipped" || status === "succeeded";
}

function getCompletedOperationStatus(items: OperationItem[]): OperationStatus {
  if (items.some((item) => item.status === "failed")) {
    return "failed";
  }

  if (items.every((item) => isFinalItemStatus(item.status))) {
    return "succeeded";
  }

  return "failed";
}

function markInterruptedItem(item: OperationItem, message: string) {
  let updated = false;

  if (!isFinalItemStatus(item.status)) {
    item.status = "failed";
    item.message = message;
    item.logs.unshift({
      timestamp: now(),
      level: "error",
      message,
    });
    updated = true;
  }

  for (const volume of item.volumes) {
    if (!isFinalItemStatus(volume.status)) {
      volume.status = "failed";
      volume.message = message;
      updated = true;
    }
  }

  return updated;
}

async function logItem(
  operationId: string,
  itemId: string,
  message: string,
  level: "info" | "error" = "info",
) {
  await updateItem(operationId, itemId, (item) => {
    item.logs.unshift({
      timestamp: now(),
      level,
      message,
    });
  });
}

async function setItemStatus(
  operationId: string,
  itemId: string,
  status: OperationItemStatus,
  message?: string,
  progress?: number,
) {
  await updateItem(operationId, itemId, (item) => {
    item.status = status;
    if (message) {
      item.message = message;
    }
    if (typeof progress === "number") {
      item.progress = progress;
    }
  });
}

type ArgoApplicationObject = {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    resourceVersion?: string;
  };
  spec?: {
    destination?: {
      namespace?: string;
    };
  };
  status?: {
    health?: {
      status?: string;
    };
    operationState?: {
      phase?: string;
    };
    resources?: Array<{
      kind?: string;
      name?: string;
      namespace?: string;
    }>;
    sync?: {
      status?: string;
    };
  };
};

type LiveInPlaceWorkload = {
  kind: "Deployment" | "StatefulSet";
  name: string;
  namespace: string;
  originalReplicas: number;
  selector: Record<string, string>;
  metadata: {
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
  };
};

type InPlaceVolumePlan = {
  backup: BackupSetSummary["volumes"][number];
  currentVolume: AppInventoryItem["volumes"][number];
  persistentVolume: V1PersistentVolume;
  persistentVolumeClaim: V1PersistentVolumeClaim;
};

type InPlaceRestorePlan = {
  app: AppInventoryItem;
  argoApplication?: {
    name: string;
    namespace: string;
  };
  volumePlans: InPlaceVolumePlan[];
  workload: LiveInPlaceWorkload;
};

type RestoreClaimTemplate = {
  persistentVolume?: V1PersistentVolume;
  persistentVolumeClaim?: V1PersistentVolumeClaim;
};

type ArgoReconcileState = {
  alreadyPaused: boolean;
  name: string;
  namespace: string;
  pausedByOrbit: boolean;
};

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition<T>(
  description: string,
  poll: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
  } = {},
) {
  const timeoutMs = options.timeoutMs ?? 300_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await poll();
    if (predicate(value)) {
      return value;
    }
    await sleep(intervalMs);
  }

  throw new Error(`${description} did not reach the expected state in time.`);
}

function buildLabelSelector(matchLabels: Record<string, string>) {
  const entries = Object.entries(matchLabels).filter(
    ([key, value]) => Boolean(key) && Boolean(value),
  );
  if (entries.length === 0) {
    throw new Error("The workload is missing selector labels, so pod readiness cannot be tracked.");
  }

  return entries.map(([key, value]) => `${key}=${value}`).join(",");
}

function isActivePod(pod: V1Pod) {
  const phase = pod.status?.phase;
  return phase !== "Succeeded" && phase !== "Failed";
}

function isPodReady(pod: V1Pod) {
  const statuses = pod.status?.containerStatuses ?? [];
  return statuses.length > 0 && statuses.every((status) => status.ready);
}

function getArgoApplicationCandidateNames(workload: LiveInPlaceWorkload) {
  const candidates = new Set<string>();

  for (const key of ARGO_INSTANCE_LABELS) {
    const candidate = workload.metadata.labels?.[key];
    if (candidate) {
      candidates.add(candidate);
    }
  }

  const trackingId = workload.metadata.annotations?.["argocd.argoproj.io/tracking-id"];
  if (trackingId) {
    const separatorIndex = trackingId.indexOf(":");
    candidates.add(separatorIndex >= 0 ? trackingId.slice(0, separatorIndex) : trackingId);
  }

  return candidates;
}

async function listArgoApplications() {
  const response = await getKubeClients().customObjects.listClusterCustomObject({
    group: ARGO_APPLICATION_GROUP,
    version: ARGO_APPLICATION_VERSION,
    plural: ARGO_APPLICATION_PLURAL,
  });

  return (response.items ?? []) as ArgoApplicationObject[];
}

async function getArgoApplication(namespace: string, name: string) {
  try {
    return (await getKubeClients().customObjects.getNamespacedCustomObject({
      group: ARGO_APPLICATION_GROUP,
      version: ARGO_APPLICATION_VERSION,
      namespace,
      plural: ARGO_APPLICATION_PLURAL,
      name,
    })) as ArgoApplicationObject;
  } catch (error) {
    if (isKubernetesErrorStatus(error, 404)) {
      return undefined;
    }

    throw error;
  }
}

function scoreArgoApplicationMatch(
  application: ArgoApplicationObject,
  workload: LiveInPlaceWorkload,
  candidateNames: Set<string>,
) {
  let score = 0;
  const applicationName = application.metadata?.name;
  const destinationNamespace =
    typeof application.spec?.destination?.namespace === "string"
      ? application.spec.destination.namespace
      : undefined;

  if (
    Array.isArray(application.status?.resources) &&
    application.status.resources.some(
      (resource) =>
        resource.kind === workload.kind &&
        resource.name === workload.name &&
        (resource.namespace || destinationNamespace || workload.namespace) === workload.namespace,
    )
  ) {
    score = Math.max(score, 100);
  }

  if (applicationName && candidateNames.has(applicationName)) {
    score = Math.max(score, destinationNamespace === workload.namespace ? 90 : 80);
  }

  if (destinationNamespace === workload.namespace) {
    score = Math.max(score, 10);
  }

  return score;
}

async function detectOwningArgoApplication(workload: LiveInPlaceWorkload) {
  const candidateNames = getArgoApplicationCandidateNames(workload);
  const matches = (await listArgoApplications())
    .map((application) => ({
      application,
      score: scoreArgoApplicationMatch(application, workload, candidateNames),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (matches.length === 0) {
    return undefined;
  }

  if (matches.length > 1 && matches[0].score === matches[1].score) {
    return undefined;
  }

  const match = matches[0].application;
  if (!match.metadata?.name || !match.metadata.namespace) {
    return undefined;
  }

  return {
    name: match.metadata.name,
    namespace: match.metadata.namespace,
  };
}

async function setArgoApplicationSkipReconcile(
  namespace: string,
  name: string,
  paused: boolean,
) {
  const application = await getArgoApplication(namespace, name);
  if (!application) {
    throw new Error(`Argo Application ${namespace}/${name} was not found.`);
  }

  const annotations = {
    ...(application.metadata?.annotations ?? {}),
  };

  if (paused) {
    annotations[ARGO_SKIP_RECONCILE_ANNOTATION] = "true";
  } else {
    delete annotations[ARGO_SKIP_RECONCILE_ANNOTATION];
  }

  await getKubeClients().customObjects.replaceNamespacedCustomObject({
    group: ARGO_APPLICATION_GROUP,
    version: ARGO_APPLICATION_VERSION,
    namespace,
    plural: ARGO_APPLICATION_PLURAL,
    name,
    body: {
      ...application,
      metadata: {
        ...application.metadata,
        annotations,
      },
    },
  });
}

async function pauseArgoApplication(namespace: string, name: string) {
  const application = await getArgoApplication(namespace, name);
  if (!application) {
    throw new Error(`Argo Application ${namespace}/${name} was not found.`);
  }

  const alreadyPaused =
    application.metadata?.annotations?.[ARGO_SKIP_RECONCILE_ANNOTATION] === "true";

  if (!alreadyPaused) {
    await setArgoApplicationSkipReconcile(namespace, name, true);
    await waitForCondition(
      `Argo Application ${namespace}/${name} pause`,
      async () => getArgoApplication(namespace, name),
      (current) =>
        current?.metadata?.annotations?.[ARGO_SKIP_RECONCILE_ANNOTATION] === "true",
    );
  }

  return {
    alreadyPaused,
    name,
    namespace,
    pausedByOrbit: !alreadyPaused,
  } satisfies ArgoReconcileState;
}

async function resumeArgoApplication(argoApplication: ArgoReconcileState) {
  if (!argoApplication.pausedByOrbit) {
    return;
  }

  await setArgoApplicationSkipReconcile(
    argoApplication.namespace,
    argoApplication.name,
    false,
  );

  await waitForCondition(
    `Argo Application ${argoApplication.namespace}/${argoApplication.name} resume`,
    async () => getArgoApplication(argoApplication.namespace, argoApplication.name),
    (current) =>
      current?.metadata?.annotations?.[ARGO_SKIP_RECONCILE_ANNOTATION] !== "true",
  );
}

async function requestArgoApplicationRefresh(
  namespace: string,
  name: string,
  refresh: "normal" | "hard" = "hard",
) {
  const application = await getArgoApplication(namespace, name);
  if (!application) {
    throw new Error(`Argo Application ${namespace}/${name} was not found.`);
  }

  await getKubeClients().customObjects.replaceNamespacedCustomObject({
    group: ARGO_APPLICATION_GROUP,
    version: ARGO_APPLICATION_VERSION,
    namespace,
    plural: ARGO_APPLICATION_PLURAL,
    name,
    body: {
      ...application,
      metadata: {
        ...application.metadata,
        annotations: {
          ...(application.metadata?.annotations ?? {}),
          [ARGO_REFRESH_ANNOTATION]: refresh,
        },
      },
    },
  });
}

async function waitForArgoApplicationSettled(argoApplication: ArgoReconcileState) {
  if (argoApplication.alreadyPaused) {
    return;
  }

  await waitForCondition(
    `Argo Application ${argoApplication.namespace}/${argoApplication.name}`,
    async () => getArgoApplication(argoApplication.namespace, argoApplication.name),
    (application) => {
      if (!application) {
        return false;
      }

      if (application.metadata?.annotations?.[ARGO_SKIP_RECONCILE_ANNOTATION] === "true") {
        return false;
      }

      const syncStatus = application.status?.sync?.status;
      const healthStatus = application.status?.health?.status;
      const operationPhase = application.status?.operationState?.phase;
      const hasStatusSignals = Boolean(syncStatus || healthStatus || operationPhase);

      if (!hasStatusSignals) {
        return true;
      }

      const syncSettled = !syncStatus || syncStatus === "Synced";
      const healthSettled = !healthStatus || healthStatus === "Healthy";
      const operationSettled =
        !operationPhase ||
        operationPhase === "Succeeded" ||
        operationPhase === "Failed" ||
        operationPhase === "Error";

      return syncSettled && healthSettled && operationSettled;
    },
    {
      timeoutMs: 10 * 60 * 1000,
      intervalMs: 5_000,
    },
  );
}

async function readLiveInPlaceWorkload(backupSet: BackupSetSummary): Promise<LiveInPlaceWorkload> {
  const namespace = backupSet.namespace;
  const name = backupSet.workloadName;
  const kind = backupSet.workloadKind;

  if (!namespace || !name || (kind !== "Deployment" && kind !== "StatefulSet")) {
    throw new Error("In-place restore is missing its source workload details.");
  }

  const { apps } = getKubeClients();

  if (kind === "Deployment") {
    const workload = await apps.readNamespacedDeployment({
      namespace,
      name,
    });

    return {
      kind,
      name,
      namespace,
      originalReplicas: workload.spec?.replicas ?? 1,
      selector: workload.spec?.selector?.matchLabels ?? {},
      metadata: {
        annotations: workload.metadata?.annotations,
        labels: workload.metadata?.labels,
      },
    };
  }

  const workload = await apps.readNamespacedStatefulSet({
    namespace,
    name,
  });

  return {
    kind,
    name,
    namespace,
    originalReplicas: workload.spec?.replicas ?? 1,
    selector: workload.spec?.selector?.matchLabels ?? {},
    metadata: {
      annotations: workload.metadata?.annotations,
      labels: workload.metadata?.labels,
    },
  };
}

async function scaleWorkload(workload: LiveInPlaceWorkload, replicas: number) {
  const { apps } = getKubeClients();

  if (workload.kind === "Deployment") {
    const deployment = await apps.readNamespacedDeployment({
      namespace: workload.namespace,
      name: workload.name,
    });

    if (!deployment.spec) {
      throw new Error(`Deployment ${workload.namespace}/${workload.name} is missing its spec.`);
    }

    deployment.spec.replicas = replicas;
    await apps.replaceNamespacedDeployment({
      namespace: workload.namespace,
      name: workload.name,
      body: deployment,
    });
    return;
  }

  const statefulSet = await apps.readNamespacedStatefulSet({
    namespace: workload.namespace,
    name: workload.name,
  });

  if (!statefulSet.spec) {
    throw new Error(`StatefulSet ${workload.namespace}/${workload.name} is missing its spec.`);
  }

  statefulSet.spec.replicas = replicas;
  await apps.replaceNamespacedStatefulSet({
    namespace: workload.namespace,
    name: workload.name,
    body: statefulSet,
  });
}

async function listWorkloadPods(workload: LiveInPlaceWorkload) {
  const response = await getKubeClients().core.listNamespacedPod({
    namespace: workload.namespace,
    labelSelector: buildLabelSelector(workload.selector),
  });

  return response.items.filter(isActivePod);
}

async function waitForWorkloadReplicaState(
  workload: LiveInPlaceWorkload,
  expectedReplicas: number,
) {
  await waitForCondition(
    `${workload.kind} ${workload.namespace}/${workload.name}`,
    async () => listWorkloadPods(workload),
    (pods) =>
      expectedReplicas === 0
        ? pods.length === 0
        : pods.length === expectedReplicas && pods.every(isPodReady),
    {
      timeoutMs: 10 * 60 * 1000,
      intervalMs: 5_000,
    },
  );
}

function backupLabelSet(
  operationId: string,
  itemId: string,
  requestedBy: string,
  item: OperationItem,
  volume: {
    pvcName?: string;
    longhornVolumeName: string;
    accessModes: string[];
    longhornAccessMode?: string;
    storageClassName?: string;
    fsType?: string;
    frontend?: string;
    dataEngine?: string;
    numberOfReplicas?: number;
  },
) {
  return {
    "orbit-app-ref": item.appRef ?? "",
    "orbit-display": item.displayName,
    "orbit-namespace": item.namespace ?? "",
    "orbit-kind": item.kind ?? "",
    "orbit-workload": item.resourceName ?? "",
    "orbit-pvc": volume.pvcName ?? "",
    "orbit-volume": volume.longhornVolumeName,
    "orbit-operation": operationId,
    "orbit-item": itemId,
    "orbit-requested-by": requestedBy,
    "orbit-pvc-access-modes": volume.accessModes.join(","),
    "orbit-access-mode": volume.longhornAccessMode ?? "",
    "orbit-storage-class": volume.storageClassName ?? "",
    "orbit-fs-type": volume.fsType ?? "",
    "orbit-frontend": volume.frontend ?? "",
    "orbit-data-engine": volume.dataEngine ?? "",
    "orbit-number-of-replicas":
      typeof volume.numberOfReplicas === "number"
        ? String(volume.numberOfReplicas)
        : "",
  };
}

async function ensureNamespace(namespace: string) {
  const { core } = getKubeClients();
  try {
    await core.readNamespace({ name: namespace });
  } catch (error) {
    if (!isKubernetesErrorStatus(error, 404)) {
      throw error;
    }

    const body: V1Namespace = {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name: namespace,
        labels: {
          "app.kubernetes.io/managed-by": "orbit-backup-ui",
        },
      },
    };
    try {
      await core.createNamespace({ body });
    } catch (createError) {
      if (!isKubernetesErrorStatus(createError, 409)) {
        throw createError;
      }
    }
  }
}

async function createRestoredVolume(
  backup: {
    labels: Record<string, string>;
    volumeName: string;
    url?: string;
    volumeSize?: string;
  },
  restoredVolumeName: string,
) {
  if (!backup.url || !backup.volumeSize) {
    throw new Error("The selected backup is missing its URL or volume size.");
  }

  const dataEngine = backup.labels["orbit-data-engine"] || "v1";
  const frontend = backup.labels["orbit-frontend"] || "blockdev";
  const accessMode = backup.labels["orbit-access-mode"] || undefined;
  const numberOfReplicas = Number(
    backup.labels["orbit-number-of-replicas"] || "2",
  );

  const spec: Record<string, unknown> = {
    size: backup.volumeSize,
    fromBackup: backup.url,
    dataEngine,
    frontend,
    numberOfReplicas,
  };

  if (accessMode) {
    spec.accessMode = accessMode;
  }

  await createLonghornObject(
    {
      apiVersion: "longhorn.io/v1beta2",
      kind: "Volume",
      metadata: {
        name: restoredVolumeName,
      },
      spec,
    },
    "volumes",
  );

  await waitForLonghornObject(
    "volumes",
    restoredVolumeName,
    (volume) =>
      volume.status?.restoreRequired === false &&
      volume.status?.state === "detached",
    {
      timeoutMs: 30 * 60 * 1000,
    },
  );
}

async function createRestoredClaim(
  namespace: string,
  restoredVolumeName: string,
  restoredPvName: string,
  restoredPvcName: string,
  backup: {
    labels: Record<string, string>;
    volumeSize?: string;
  },
  template: RestoreClaimTemplate = {},
) {
  const { core } = getKubeClients();
  const sourcePersistentVolume = template.persistentVolume;
  const sourcePersistentVolumeClaim = template.persistentVolumeClaim;

  const accessModes =
    sourcePersistentVolumeClaim?.spec?.accessModes ??
    (backup.labels["orbit-pvc-access-modes"] || "ReadWriteOnce")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  const storageClassName =
    sourcePersistentVolumeClaim?.spec?.storageClassName ??
    sourcePersistentVolume?.spec?.storageClassName ??
    backup.labels["orbit-storage-class"] ??
    "longhorn";
  const fsType =
    sourcePersistentVolume?.spec?.csi?.fsType ??
    backup.labels["orbit-fs-type"] ??
    undefined;
  const storage =
    sourcePersistentVolumeClaim?.spec?.resources?.requests?.storage ??
    sourcePersistentVolume?.spec?.capacity?.storage ??
    backup.volumeSize ??
    "1073741824";
  const volumeMode =
    sourcePersistentVolumeClaim?.spec?.volumeMode ??
    sourcePersistentVolume?.spec?.volumeMode ??
    "Filesystem";
  const persistentVolumeReclaimPolicy =
    sourcePersistentVolume?.spec?.persistentVolumeReclaimPolicy ?? "Retain";
  const persistentVolumeLabels = {
    ...(sourcePersistentVolume?.metadata?.labels ?? {}),
    [ORBIT_MANAGED_BY_LABEL]: ORBIT_MANAGED_BY_VALUE,
  };
  const persistentVolumeClaimLabels = {
    ...(sourcePersistentVolumeClaim?.metadata?.labels ?? {}),
    [ORBIT_MANAGED_BY_LABEL]: ORBIT_MANAGED_BY_VALUE,
  };
  const persistentVolumeClaimAnnotations = Object.fromEntries(
    Object.entries(sourcePersistentVolumeClaim?.metadata?.annotations ?? {}).filter(
      ([key]) => !EPHEMERAL_PVC_ANNOTATIONS.has(key),
    ),
  );

  const persistentVolume: V1PersistentVolume = {
    apiVersion: "v1",
    kind: "PersistentVolume",
    metadata: {
      name: restoredPvName,
      labels: persistentVolumeLabels,
    },
    spec: {
      capacity: {
        storage,
      },
      accessModes,
      persistentVolumeReclaimPolicy,
      storageClassName,
      volumeMode,
      csi: {
        driver: "driver.longhorn.io",
        fsType,
        volumeHandle: restoredVolumeName,
      },
      claimRef: {
        apiVersion: "v1",
        kind: "PersistentVolumeClaim",
        namespace,
        name: restoredPvcName,
      },
    },
  };

  const persistentVolumeClaim: V1PersistentVolumeClaim = {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      namespace,
      name: restoredPvcName,
      labels: persistentVolumeClaimLabels,
      annotations:
        Object.keys(persistentVolumeClaimAnnotations).length > 0
          ? persistentVolumeClaimAnnotations
          : undefined,
      ownerReferences: sourcePersistentVolumeClaim?.metadata?.ownerReferences,
    },
    spec: {
      accessModes,
      storageClassName,
      volumeName: restoredPvName,
      volumeMode,
      resources: {
        requests: {
          storage,
        },
      },
    },
  };

  await core.createPersistentVolume({ body: persistentVolume });
  await core.createNamespacedPersistentVolumeClaim({
    namespace,
    body: persistentVolumeClaim,
  });
}

function findCurrentAppForBackupSet(apps: AppInventoryItem[], backupSet: BackupSetSummary) {
  if (backupSet.currentAppRef) {
    const matchedApp = apps.find((app) => app.ref === backupSet.currentAppRef);
    if (matchedApp) {
      return matchedApp;
    }
  }

  return apps.find(
    (app) =>
      app.namespace === backupSet.namespace &&
      app.kind === backupSet.workloadKind &&
      app.name === backupSet.workloadName,
  );
}

async function buildInPlaceRestorePlan(
  backupSet: BackupSetSummary,
  apps: AppInventoryItem[],
): Promise<InPlaceRestorePlan> {
  const validationError = getInPlaceRestoreValidationError(backupSet);
  if (validationError) {
    throw new Error(validationError);
  }

  const app = findCurrentAppForBackupSet(apps, backupSet);
  if (!app) {
    throw new Error(
      `The original workload ${backupSet.displayName} is no longer present, so in-place restore cannot continue.`,
    );
  }

  if (app.volumes.length !== backupSet.volumes.length) {
    throw new Error(
      "In-place restore requires the selected backup set to cover every current Longhorn-backed PVC on the workload.",
    );
  }

  const currentByPvcName = new Map(app.volumes.map((volume) => [volume.pvcName, volume]));
  const currentByLonghornVolumeName = new Map(
    app.volumes.map((volume) => [volume.longhornVolumeName, volume]),
  );
  const matchedVolumeNames = new Set<string>();
  const { core } = getKubeClients();
  const volumePlans: InPlaceVolumePlan[] = [];

  for (const backup of backupSet.volumes) {
    const currentVolume =
      (backup.pvcName ? currentByPvcName.get(backup.pvcName) : undefined) ??
      currentByLonghornVolumeName.get(backup.volumeName);

    if (!currentVolume || !currentVolume.pvName) {
      throw new Error(
        `Could not match backup volume ${backup.volumeName} to the current workload PVCs.`,
      );
    }

    if (matchedVolumeNames.has(currentVolume.longhornVolumeName)) {
      throw new Error(
        `Backup volume ${backup.volumeName} matched the same live Longhorn volume more than once.`,
      );
    }

    matchedVolumeNames.add(currentVolume.longhornVolumeName);

    const persistentVolumeClaim = await core.readNamespacedPersistentVolumeClaim({
      namespace: app.namespace,
      name: currentVolume.pvcName,
    });
    const persistentVolume = await core.readPersistentVolume({
      name: currentVolume.pvName,
    });

    volumePlans.push({
      backup,
      currentVolume,
      persistentVolume,
      persistentVolumeClaim,
    });
  }

  if (matchedVolumeNames.size !== app.volumes.length) {
    throw new Error(
      "In-place restore could not account for every current workload volume. Use clone or PVC-only restore instead.",
    );
  }

  const workload = await readLiveInPlaceWorkload(backupSet);

  return {
    app,
    argoApplication: await detectOwningArgoApplication(workload),
    volumePlans,
    workload,
  };
}

async function setPersistentVolumeReclaimPolicy(
  persistentVolumeName: string,
  persistentVolumeReclaimPolicy: string,
) {
  const { core } = getKubeClients();
  const persistentVolume = await core.readPersistentVolume({
    name: persistentVolumeName,
  });

  if (!persistentVolume.spec) {
    throw new Error(`PersistentVolume ${persistentVolumeName} is missing its spec.`);
  }

  if (
    persistentVolume.spec.persistentVolumeReclaimPolicy ===
    persistentVolumeReclaimPolicy
  ) {
    return persistentVolume;
  }

  persistentVolume.spec.persistentVolumeReclaimPolicy = persistentVolumeReclaimPolicy;
  await core.replacePersistentVolume({
    name: persistentVolumeName,
    body: persistentVolume,
  });

  return persistentVolume;
}

async function waitForPersistentVolumeClaimDeleted(namespace: string, name: string) {
  await waitForCondition(
    `PersistentVolumeClaim ${namespace}/${name} deletion`,
    async () => {
      try {
        return await getKubeClients().core.readNamespacedPersistentVolumeClaim({
          namespace,
          name,
        });
      } catch (error) {
        if (isKubernetesErrorStatus(error, 404)) {
          return undefined;
        }

        throw error;
      }
    },
    (persistentVolumeClaim) => !persistentVolumeClaim,
  );
}

async function waitForPersistentVolumeDeleted(name: string) {
  await waitForCondition(
    `PersistentVolume ${name} deletion`,
    async () => {
      try {
        return await getKubeClients().core.readPersistentVolume({
          name,
        });
      } catch (error) {
        if (isKubernetesErrorStatus(error, 404)) {
          return undefined;
        }

        throw error;
      }
    },
    (persistentVolume) => !persistentVolume,
  );
}

async function waitForPersistentVolumeClaimBound(namespace: string, name: string) {
  await waitForCondition(
    `PersistentVolumeClaim ${namespace}/${name} binding`,
    async () =>
      getKubeClients().core.readNamespacedPersistentVolumeClaim({
        namespace,
        name,
      }),
    (persistentVolumeClaim) => persistentVolumeClaim.status?.phase === "Bound",
  );
}

async function waitForLonghornVolumeDeleted(name: string) {
  await waitForCondition(
    `Longhorn volume ${name} deletion`,
    async () => getLonghornObject("volumes", name),
    (volume) => !volume,
  );
}

async function replaceLonghornVolumeInPlace(volumePlan: InPlaceVolumePlan) {
  const { core } = getKubeClients();
  const persistentVolumeName = volumePlan.persistentVolume.metadata?.name;
  const persistentVolumeClaimName = volumePlan.persistentVolumeClaim.metadata?.name;

  if (!persistentVolumeName || !persistentVolumeClaimName) {
    throw new Error("The current PVC binding is missing its PV or PVC name.");
  }

  await setPersistentVolumeReclaimPolicy(persistentVolumeName, "Retain");

  await core.deleteNamespacedPersistentVolumeClaim({
    namespace: volumePlan.persistentVolumeClaim.metadata?.namespace ?? "",
    name: persistentVolumeClaimName,
    body: {},
  });
  await waitForPersistentVolumeClaimDeleted(
    volumePlan.persistentVolumeClaim.metadata?.namespace ?? "",
    persistentVolumeClaimName,
  );

  await core.deletePersistentVolume({
    name: persistentVolumeName,
    body: {},
  });
  await waitForPersistentVolumeDeleted(persistentVolumeName);

  await deleteLonghornObject("volumes", volumePlan.currentVolume.longhornVolumeName);
  await waitForLonghornVolumeDeleted(volumePlan.currentVolume.longhornVolumeName);

  await createRestoredVolume(
    volumePlan.backup,
    volumePlan.currentVolume.longhornVolumeName,
  );
  await createRestoredClaim(
    volumePlan.persistentVolumeClaim.metadata?.namespace ?? "",
    volumePlan.currentVolume.longhornVolumeName,
    persistentVolumeName,
    persistentVolumeClaimName,
    volumePlan.backup,
    {
      persistentVolume: volumePlan.persistentVolume,
      persistentVolumeClaim: volumePlan.persistentVolumeClaim,
    },
  );
  await waitForPersistentVolumeClaimBound(
    volumePlan.persistentVolumeClaim.metadata?.namespace ?? "",
    persistentVolumeClaimName,
  );
}

type CloneWorkloadPlan =
  | {
      kind: "Deployment";
      cloneName: string;
      restoreInstance: string;
      sourceName: string;
      sourceNamespace: string;
      targetNamespace: string;
    }
  | {
      kind: "StatefulSet";
      cloneName: string;
      restoreInstance: string;
      restoredTemplateClaims: Map<number, Set<string>>;
      sourceName: string;
      sourceNamespace: string;
      sourceStatefulSet: V1StatefulSet;
      startOrdinal: number;
      targetNamespace: string;
      templateClaimNames: string[];
    };

type CloneWorkloadResult = {
  kind: "Deployment" | "StatefulSet";
  name: string;
  notes: string[];
  replicas?: number;
  serviceName?: string;
};

function getStatefulSetTemplateClaimMatch(
  sourceName: string,
  templateClaimNames: string[],
  pvcName?: string,
) {
  if (!pvcName) {
    return undefined;
  }

  for (const templateClaimName of templateClaimNames) {
    const prefix = `${templateClaimName}-${sourceName}-`;
    if (!pvcName.startsWith(prefix)) {
      continue;
    }

    const ordinalValue = Number(pvcName.slice(prefix.length));
    if (!Number.isInteger(ordinalValue) || ordinalValue < 0) {
      continue;
    }

    return {
      ordinal: ordinalValue,
      templateClaimName,
    };
  }

  return undefined;
}

function getSafeStatefulSetReplicaCount(
  templateClaimNames: string[],
  restoredTemplateClaims: Map<number, Set<string>>,
  startOrdinal: number,
  desiredReplicas: number,
) {
  if (templateClaimNames.length === 0) {
    return desiredReplicas;
  }

  let safeReplicas = 0;
  for (let offset = 0; offset < desiredReplicas; offset += 1) {
    const ordinal = startOrdinal + offset;
    const restoredClaimsForOrdinal = restoredTemplateClaims.get(ordinal);
    if (
      !restoredClaimsForOrdinal ||
      !templateClaimNames.every((templateClaimName) =>
        restoredClaimsForOrdinal.has(templateClaimName),
      )
    ) {
      break;
    }

    safeReplicas = offset + 1;
  }

  return safeReplicas;
}

function resolveRestoredClaim(
  backup: {
    pvcName?: string;
    volumeName: string;
  },
  clonePlan?: CloneWorkloadPlan,
) {
  if (clonePlan?.kind === "StatefulSet") {
    const templateClaimMatch = getStatefulSetTemplateClaimMatch(
      clonePlan.sourceName,
      clonePlan.templateClaimNames,
      backup.pvcName,
    );

    if (templateClaimMatch) {
      return {
        restoredPvcName: `${templateClaimMatch.templateClaimName}-${clonePlan.cloneName}-${templateClaimMatch.ordinal}`,
        templateClaimMatch,
      };
    }
  }

  return {
    restoredPvcName: buildName(backup.pvcName || backup.volumeName, "restore", shortId()),
    templateClaimMatch: undefined,
  };
}

async function prepareCloneWorkloadPlan(
  backupSet: BackupSetSummary,
  targetNamespace: string,
): Promise<CloneWorkloadPlan> {
  const sourceNamespace = backupSet.namespace;
  const sourceName = backupSet.workloadName;

  if (!sourceNamespace || !sourceName || !backupSet.workloadKind) {
    throw new Error("Clone restore is missing its source workload details.");
  }

  const cloneName = buildName(sourceName, "restore", shortId());
  const restoreInstance = shortId();

  if (backupSet.workloadKind === "StatefulSet") {
    const { apps } = getKubeClients();
    const sourceStatefulSet = await apps.readNamespacedStatefulSet({
      namespace: sourceNamespace,
      name: sourceName,
    });

    return {
      kind: "StatefulSet",
      cloneName,
      restoreInstance,
      restoredTemplateClaims: new Map<number, Set<string>>(),
      sourceName,
      sourceNamespace,
      sourceStatefulSet,
      startOrdinal: sourceStatefulSet.spec?.ordinals?.start ?? 0,
      targetNamespace,
      templateClaimNames: (sourceStatefulSet.spec?.volumeClaimTemplates ?? [])
        .map((template) => template.metadata?.name)
        .filter((name): name is string => Boolean(name))
        .sort((left, right) => right.length - left.length),
    };
  }

  return {
    kind: "Deployment",
    cloneName,
    restoreInstance,
    sourceName,
    sourceNamespace,
    targetNamespace,
  };
}

function sanitizeDeploymentForClone(
  sourceDeployment: V1Deployment,
  cloneName: string,
  restoreInstance: string,
  targetNamespace: string,
  claimNameMap: Map<string, string>,
) {
  const deployment = structuredClone(sourceDeployment);
  const podSpec = deployment.spec?.template.spec;

  if (!deployment.spec || !deployment.spec.template || !podSpec) {
    throw new Error("The source deployment is missing a pod template.");
  }

  deployment.metadata = {
    name: cloneName,
    namespace: targetNamespace,
    labels: {
      ...(sourceDeployment.metadata?.labels ?? {}),
      "orbit.myrenic.io/restore-source":
        buildRestoreSourceLabelValue(
          sourceDeployment.metadata?.namespace,
          sourceDeployment.metadata?.name,
        ),
      "orbit.myrenic.io/restore-instance": restoreInstance,
    },
  };

  delete deployment.status;

  if (deployment.spec?.selector?.matchLabels) {
    deployment.spec.selector.matchLabels = {
      ...deployment.spec.selector.matchLabels,
      "orbit.myrenic.io/restore-instance": restoreInstance,
    };
  }

  deployment.spec.template.metadata = {
    ...deployment.spec.template.metadata,
    labels: {
      ...(deployment.spec.template.metadata?.labels ?? {}),
      ...(deployment.spec.selector?.matchLabels ?? {}),
    },
  };

  podSpec.volumes = (podSpec.volumes ?? []).map((volume) => {
    const claimName = volume.persistentVolumeClaim?.claimName;
    if (claimName && claimNameMap.has(claimName)) {
      return {
        ...volume,
        persistentVolumeClaim: {
          claimName: claimNameMap.get(claimName) ?? claimName,
        },
      };
    }

    return volume;
  });

  return deployment;
}

async function cloneDeployment(
  plan: Extract<CloneWorkloadPlan, { kind: "Deployment" }>,
  claimNameMap: Map<string, string>,
) {
  const { apps } = getKubeClients();
  const source = await apps.readNamespacedDeployment({
    namespace: plan.sourceNamespace,
    name: plan.sourceName,
  });

  const body = sanitizeDeploymentForClone(
    source,
    plan.cloneName,
    plan.restoreInstance,
    plan.targetNamespace,
    claimNameMap,
  );

  await apps.createNamespacedDeployment({
    namespace: plan.targetNamespace,
    body,
  });

  return {
    kind: "Deployment",
    name: plan.cloneName,
    notes: [],
  } satisfies CloneWorkloadResult;
}

function sanitizeServiceForClone(
  sourceService: V1Service,
  cloneName: string,
  restoreInstance: string,
  targetNamespace: string,
) {
  const service = structuredClone(sourceService);

  service.metadata = {
    name: cloneName,
    namespace: targetNamespace,
    labels: {
      ...(sourceService.metadata?.labels ?? {}),
      "orbit.myrenic.io/restore-source":
        buildRestoreSourceLabelValue(
          sourceService.metadata?.namespace,
          sourceService.metadata?.name,
        ),
      "orbit.myrenic.io/restore-instance": restoreInstance,
    },
    annotations: sourceService.metadata?.annotations,
  };

  delete service.status;

  const sourceSpec = sourceService.spec;
  service.spec = {
    ...sourceSpec,
    ports: (sourceSpec?.ports ?? []).map((port) => {
      const sanitizedPort = structuredClone(port);
      delete sanitizedPort.nodePort;
      return sanitizedPort;
    }),
    selector: sourceSpec?.selector
      ? {
          ...sourceSpec.selector,
          "orbit.myrenic.io/restore-instance": restoreInstance,
        }
      : undefined,
  };

  if (!service.spec) {
    throw new Error("The StatefulSet service is missing its spec.");
  }

  delete service.spec.clusterIPs;
  delete service.spec.healthCheckNodePort;
  delete service.spec.ipFamilies;
  delete service.spec.ipFamilyPolicy;
  delete service.spec.internalTrafficPolicy;
  delete service.spec.sessionAffinityConfig;

  if (sourceSpec?.clusterIP === "None") {
    service.spec.clusterIP = "None";
  } else {
    delete service.spec.clusterIP;
  }

  return service;
}

async function maybeCloneStatefulSetService(
  plan: Extract<CloneWorkloadPlan, { kind: "StatefulSet" }>,
) {
  const sourceServiceName = plan.sourceStatefulSet.spec?.serviceName;
  if (!sourceServiceName) {
    return {
      note: "The source StatefulSet has no governing Service configured.",
      serviceName: undefined,
    };
  }

  const { core } = getKubeClients();

  try {
    const sourceService = await core.readNamespacedService({
      namespace: plan.sourceNamespace,
      name: sourceServiceName,
    });
    const serviceName = buildName(sourceServiceName, "restore", shortId());

    await core.createNamespacedService({
      namespace: plan.targetNamespace,
      body: sanitizeServiceForClone(
        sourceService,
        serviceName,
        plan.restoreInstance,
        plan.targetNamespace,
      ),
    });

    return {
      note: `Cloned governing Service ${sourceServiceName} as ${serviceName}.`,
      serviceName,
    };
  } catch (error) {
    if (isKubernetesErrorStatus(error, 404)) {
      return {
        note: `The source governing Service ${sourceServiceName} was not found. The restored StatefulSet may need manual Service setup.`,
        serviceName: undefined,
      };
    }

    throw error;
  }
}

function sanitizeStatefulSetForClone(
  plan: Extract<CloneWorkloadPlan, { kind: "StatefulSet" }>,
  claimNameMap: Map<string, string>,
  clonedServiceName?: string,
) {
  const statefulSet = structuredClone(plan.sourceStatefulSet);
  const podSpec = statefulSet.spec?.template.spec;

  if (!statefulSet.spec || !statefulSet.spec.template || !podSpec) {
    throw new Error("The source StatefulSet is missing a pod template.");
  }

  statefulSet.metadata = {
    name: plan.cloneName,
    namespace: plan.targetNamespace,
    labels: {
      ...(plan.sourceStatefulSet.metadata?.labels ?? {}),
      "orbit.myrenic.io/restore-source":
        buildRestoreSourceLabelValue(
          plan.sourceStatefulSet.metadata?.namespace,
          plan.sourceStatefulSet.metadata?.name,
        ),
      "orbit.myrenic.io/restore-instance": plan.restoreInstance,
    },
  };

  delete statefulSet.status;

  if (statefulSet.spec.selector?.matchLabels) {
    statefulSet.spec.selector.matchLabels = {
      ...statefulSet.spec.selector.matchLabels,
      "orbit.myrenic.io/restore-instance": plan.restoreInstance,
    };
  }

  statefulSet.spec.template.metadata = {
    ...statefulSet.spec.template.metadata,
    labels: {
      ...(statefulSet.spec.template.metadata?.labels ?? {}),
      ...(statefulSet.spec.selector?.matchLabels ?? {}),
    },
  };

  if (clonedServiceName) {
    statefulSet.spec.serviceName = clonedServiceName;
  }

  podSpec.volumes = (podSpec.volumes ?? []).map((volume) => {
    const claimName = volume.persistentVolumeClaim?.claimName;
    if (claimName && claimNameMap.has(claimName)) {
      return {
        ...volume,
        persistentVolumeClaim: {
          claimName: claimNameMap.get(claimName) ?? claimName,
        },
      };
    }

    return volume;
  });

  statefulSet.spec.volumeClaimTemplates = (plan.sourceStatefulSet.spec?.volumeClaimTemplates ?? [])
    .map((template) => ({
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: {
        name: template.metadata?.name,
        labels: template.metadata?.labels,
        annotations: template.metadata?.annotations,
      },
      spec: structuredClone(template.spec),
    }));

  const desiredReplicas = plan.sourceStatefulSet.spec?.replicas ?? 1;
  if (plan.templateClaimNames.length > 0) {
    statefulSet.spec.replicas = getSafeStatefulSetReplicaCount(
      plan.templateClaimNames,
      plan.restoredTemplateClaims,
      plan.startOrdinal,
      desiredReplicas,
    );
  }

  return {
    body: statefulSet,
    desiredReplicas,
    replicas: statefulSet.spec.replicas ?? desiredReplicas,
  };
}

async function cloneStatefulSet(
  plan: Extract<CloneWorkloadPlan, { kind: "StatefulSet" }>,
  claimNameMap: Map<string, string>,
) {
  const { apps } = getKubeClients();
  const notes: string[] = [];

  const { note, serviceName } = await maybeCloneStatefulSetService(plan);
  notes.push(note);

  const clone = sanitizeStatefulSetForClone(plan, claimNameMap, serviceName);
  if (clone.replicas !== clone.desiredReplicas) {
    notes.push(
      `Scaled the restored StatefulSet to ${clone.replicas} replica${
        clone.replicas === 1 ? "" : "s"
      } because only that many contiguous restored PVC sets were available.`,
    );
  }

  await apps.createNamespacedStatefulSet({
    namespace: plan.targetNamespace,
    body: clone.body,
  });

  return {
    kind: "StatefulSet",
    name: plan.cloneName,
    notes,
    replicas: clone.replicas,
    serviceName,
  } satisfies CloneWorkloadResult;
}

async function runInPlaceRestoreItem(
  operation: OperationRecord,
  item: OperationItem,
  backupSet: BackupSetSummary,
  snapshotApps: AppInventoryItem[],
) {
  const plan = await buildInPlaceRestorePlan(backupSet, snapshotApps);
  const progressStep = Math.max(1, Math.floor(40 / Math.max(plan.volumePlans.length, 1)));
  let argoApplicationState: ArgoReconcileState | undefined;
  let workloadScaledDown = false;
  let volumesRestored = false;
  let argoResumed = false;

  await setItemStatus(
    operation.id,
    item.id,
    "running",
    `Preparing in-place restore for ${plan.workload.namespace}/${plan.workload.kind}/${plan.workload.name}.`,
    5,
  );

  if (plan.argoApplication) {
    await logItem(
      operation.id,
      item.id,
      `Detected owning Argo Application ${plan.argoApplication.namespace}/${plan.argoApplication.name}.`,
    );
  } else {
    await logItem(
      operation.id,
      item.id,
      "No owning Argo Application was detected. Continuing with direct workload control.",
    );
  }

  try {
    if (plan.argoApplication) {
      argoApplicationState = await pauseArgoApplication(
        plan.argoApplication.namespace,
        plan.argoApplication.name,
      );

      await logItem(
        operation.id,
        item.id,
        argoApplicationState.alreadyPaused
          ? `Argo Application ${argoApplicationState.namespace}/${argoApplicationState.name} was already paused before restore.`
          : `Paused Argo Application ${argoApplicationState.namespace}/${argoApplicationState.name}.`,
      );
    }

    if (plan.workload.originalReplicas > 0) {
      await logItem(
        operation.id,
        item.id,
        `Scaling ${plan.workload.kind} ${plan.workload.namespace}/${plan.workload.name} down to 0 replicas.`,
      );
      await scaleWorkload(plan.workload, 0);
      await waitForWorkloadReplicaState(plan.workload, 0);
      workloadScaledDown = true;
    } else {
      await logItem(
        operation.id,
        item.id,
        `${plan.workload.kind} ${plan.workload.namespace}/${plan.workload.name} is already scaled down.`,
      );
    }

    await setItemStatus(
      operation.id,
      item.id,
      "running",
      `Replacing ${plan.volumePlans.length} in-place volume${plan.volumePlans.length === 1 ? "" : "s"} under the existing workload identity.`,
      20,
    );

    for (const [index, volumePlan] of plan.volumePlans.entries()) {
      const persistentVolumeName = volumePlan.persistentVolume.metadata?.name;
      const persistentVolumeClaimName = volumePlan.persistentVolumeClaim.metadata?.name;

      if (!persistentVolumeName || !persistentVolumeClaimName) {
        throw new Error("The current PV/PVC binding is missing its name.");
      }

      await updateItem(operation.id, item.id, (entry) => {
        entry.volumes[index] = {
          volumeName: volumePlan.currentVolume.longhornVolumeName,
          pvcName: persistentVolumeClaimName,
          restoredVolumeName: volumePlan.currentVolume.longhornVolumeName,
          restoredClaimName: persistentVolumeClaimName,
          restoredNamespace: plan.workload.namespace,
          progress: 10,
          status: "running",
        };
      });

      await logItem(
        operation.id,
        item.id,
        `Detaching and replacing ${volumePlan.currentVolume.longhornVolumeName} for PVC ${persistentVolumeClaimName}.`,
      );

      await waitForLonghornObject(
        "volumes",
        volumePlan.currentVolume.longhornVolumeName,
        (volume) => volume.status?.state === "detached",
        {
          timeoutMs: 10 * 60 * 1000,
          intervalMs: 5_000,
        },
      );

      await replaceLonghornVolumeInPlace(volumePlan);

      await updateItem(operation.id, item.id, (entry) => {
        const volumeState = entry.volumes[index];
        volumeState.progress = 100;
        volumeState.status = "succeeded";
      });

      await setItemStatus(
        operation.id,
        item.id,
        "running",
        `Replaced ${index + 1}/${plan.volumePlans.length} volume${plan.volumePlans.length === 1 ? "" : "s"} in place.`,
        20 + progressStep * (index + 1),
      );
    }

    volumesRestored = true;

    if (argoApplicationState?.pausedByOrbit) {
      await logItem(
        operation.id,
        item.id,
        `Resuming Argo Application ${argoApplicationState.namespace}/${argoApplicationState.name}.`,
      );
      await resumeArgoApplication(argoApplicationState);
      argoResumed = true;
      await requestArgoApplicationRefresh(
        argoApplicationState.namespace,
        argoApplicationState.name,
      );
      await logItem(
        operation.id,
        item.id,
        `Requested a hard refresh for Argo Application ${argoApplicationState.namespace}/${argoApplicationState.name} so Git can re-assert the live workload before it starts again.`,
      );
    } else if (plan.workload.originalReplicas > 0) {
      await logItem(
        operation.id,
        item.id,
        `Scaling ${plan.workload.kind} ${plan.workload.namespace}/${plan.workload.name} back to ${plan.workload.originalReplicas} replica${plan.workload.originalReplicas === 1 ? "" : "s"}.`,
      );
      await scaleWorkload(plan.workload, plan.workload.originalReplicas);
    }

    await waitForWorkloadReplicaState(plan.workload, plan.workload.originalReplicas);

    if (argoApplicationState && !argoApplicationState.alreadyPaused) {
      await waitForArgoApplicationSettled(argoApplicationState);
    }

    await setItemStatus(
      operation.id,
      item.id,
      "succeeded",
      `Restored ${plan.workload.namespace}/${plan.workload.kind}/${plan.workload.name} in place${argoApplicationState ? ` with Argo Application ${argoApplicationState.namespace}/${argoApplicationState.name}` : ""}.`,
      100,
    );
  } catch (error) {
    const cleanupNotes: string[] = [];
    const argoOwnsRecovery = Boolean(
      argoApplicationState && !argoApplicationState.alreadyPaused,
    );

    if (volumesRestored) {
      if (plan.workload.originalReplicas > 0 && workloadScaledDown && !argoOwnsRecovery) {
        try {
          await scaleWorkload(plan.workload, plan.workload.originalReplicas);
          cleanupNotes.push(
            `Scaled ${plan.workload.kind} ${plan.workload.namespace}/${plan.workload.name} back to ${plan.workload.originalReplicas} replica${plan.workload.originalReplicas === 1 ? "" : "s"} after the restore error.`,
          );
        } catch (cleanupError) {
          cleanupNotes.push(
            cleanupError instanceof Error
              ? `Failed to scale the workload back up automatically: ${cleanupError.message}`
              : "Failed to scale the workload back up automatically.",
          );
        }
      } else if (plan.workload.originalReplicas > 0 && workloadScaledDown && argoOwnsRecovery) {
        cleanupNotes.push(
          `Argo Application ${argoApplicationState?.namespace}/${argoApplicationState?.name} was resumed and remains responsible for reconciling the workload back to its desired state.`,
        );
      }

      if (argoApplicationState?.pausedByOrbit && !argoResumed) {
        try {
          await resumeArgoApplication(argoApplicationState);
          argoResumed = true;
          cleanupNotes.push(
            `Resumed Argo Application ${argoApplicationState.namespace}/${argoApplicationState.name} after the restore error.`,
          );
        } catch (cleanupError) {
          cleanupNotes.push(
            cleanupError instanceof Error
              ? `Failed to resume Argo automatically: ${cleanupError.message}`
              : "Failed to resume Argo automatically.",
          );
        }
      }
    } else {
      if (workloadScaledDown) {
        cleanupNotes.push(
          `The workload remains scaled down because in-place volume replacement did not complete safely.`,
        );
      }

      if (argoApplicationState?.pausedByOrbit && !argoResumed) {
        cleanupNotes.push(
          `Argo Application ${argoApplicationState.namespace}/${argoApplicationState.name} remains paused to avoid reconciling a partial restore.`,
        );
      }
    }

    for (const note of cleanupNotes) {
      await logItem(operation.id, item.id, note, "error");
    }

    const message =
      error instanceof Error ? error.message : "Unexpected in-place restore failure.";
    throw new Error([message, ...cleanupNotes].join(" "));
  }
}

async function runBackupOperation(operation: OperationRecord) {
  const snapshot = await getClusterSnapshot(true);
  const defaultTarget =
    snapshot.targets.find((target) => target.name === "default") ||
    snapshot.targets[0];

  if (!defaultTarget?.available) {
    throw new Error("Longhorn backup target is not available.");
  }

  for (const item of operation.items) {
    const app = snapshot.apps.find((entry) => entry.ref === item.appRef);
    if (!app) {
      await setItemStatus(
        operation.id,
        item.id,
        "failed",
        "The workload no longer exists in the cluster.",
        0,
      );
      continue;
    }

    if (app.volumes.length === 0) {
      await setItemStatus(
        operation.id,
        item.id,
        "skipped",
        "This workload has no PVC-backed Longhorn volumes.",
        100,
      );
      continue;
    }

    await setItemStatus(operation.id, item.id, "running", "Creating snapshots...", 5);

    const itemVolumeStates = app.volumes.map((volume) => ({
      volumeName: volume.longhornVolumeName,
      pvcName: volume.pvcName,
      status: "queued" as const,
      progress: 0,
    }));

    await updateItem(operation.id, item.id, (entry) => {
      entry.volumes = itemVolumeStates;
    });

    for (const [index, volume] of app.volumes.entries()) {
      const snapshotName = buildName(
        app.name,
        "snap",
        shortId(),
        String(index + 1),
      );
      const backupName = buildName(
        app.name,
        "backup",
        shortId(),
        String(index + 1),
      );

      await logItem(
        operation.id,
        item.id,
        `Creating snapshot ${snapshotName} for ${volume.longhornVolumeName}.`,
      );

      await updateItem(operation.id, item.id, (entry) => {
        const volumeState = entry.volumes[index];
        volumeState.snapshotName = snapshotName;
        volumeState.status = "running";
        volumeState.progress = 10;
      });

      let snapshotCreated = false;
      let backupError: unknown;

      try {
        await createLonghornObject(
          {
            apiVersion: "longhorn.io/v1beta2",
            kind: "Snapshot",
            metadata: {
              name: snapshotName,
            },
            spec: {
              volume: volume.longhornVolumeName,
              createSnapshot: true,
              labels: backupLabelSet(operation.id, item.id, operation.requestedBy, item, volume),
            },
          },
          "snapshots",
        );
        snapshotCreated = true;

        await waitForLonghornObject(
          "snapshots",
          snapshotName,
          (snapshotObject) => snapshotObject.status?.readyToUse === true,
          {
            timeoutMs: 5 * 60 * 1000,
          },
        );

        await logItem(
          operation.id,
          item.id,
          `Creating ${operation.mode} backup ${backupName}.`,
        );

        await updateItem(operation.id, item.id, (entry) => {
          const volumeState = entry.volumes[index];
          volumeState.backupName = backupName;
          volumeState.progress = 25;
        });

        await createLonghornObject(
          {
            apiVersion: "longhorn.io/v1beta2",
            kind: "Backup",
            metadata: {
              name: backupName,
            },
            spec: {
              backupMode: operation.mode as BackupMode,
              snapshotName,
              labels: backupLabelSet(operation.id, item.id, operation.requestedBy, item, volume),
            },
          },
          "backups",
        );

        await waitForLonghornObject(
          "backups",
          backupName,
          (backupObject) => {
            const state = String(backupObject.status?.state ?? "");
            return state === "Completed" || state === "Error" || state === "Unknown";
          },
          {
            timeoutMs: 45 * 60 * 1000,
            intervalMs: 3_000,
            onPoll: async (backupObject) => {
              await updateItem(operation.id, item.id, (entry) => {
                const volumeState = entry.volumes[index];
                volumeState.progress = Number(backupObject.status?.progress ?? 0);
                volumeState.message =
                  typeof backupObject.status?.error === "string"
                    ? backupObject.status.error
                    : undefined;
              });
            },
          },
        );

        const backupObject = await getLonghornObject("backups", backupName);
        const backupState = String(backupObject?.status?.state ?? "");
        if (backupState !== "Completed") {
          const errorMessage =
            typeof backupObject?.status?.error === "string"
              ? backupObject.status.error
              : `Backup ${backupName} ended in state ${backupState || "Unknown"}.`;
          await updateItem(operation.id, item.id, (entry) => {
            const volumeState = entry.volumes[index];
            volumeState.status = "failed";
            volumeState.message = errorMessage;
            volumeState.progress = Number(backupObject?.status?.progress ?? 0);
          });
          throw new Error(errorMessage);
        }

        await updateItem(operation.id, item.id, (entry) => {
          const volumeState = entry.volumes[index];
          volumeState.status = "succeeded";
          volumeState.progress = 100;
        });

        await logItem(
          operation.id,
          item.id,
          `Backup ${backupName} completed for ${volume.longhornVolumeName}.`,
        );
      } catch (error) {
        backupError = error;
        const message =
          error instanceof Error ? error.message : "Unexpected volume backup failure.";
        await updateItem(operation.id, item.id, (entry) => {
          const volumeState = entry.volumes[index];
          volumeState.status = "failed";
          volumeState.message = message;
        });
        throw error;
      } finally {
        if (snapshotCreated) {
          try {
            await deleteLonghornObject("snapshots", snapshotName);
          } catch (cleanupError) {
            const cleanupMessage =
              cleanupError instanceof Error
                ? cleanupError.message
                : `Failed to delete snapshot ${snapshotName}.`;
            if (backupError) {
              await logItem(
                operation.id,
                item.id,
                `Snapshot cleanup failed for ${snapshotName}: ${cleanupMessage}`,
                "error",
              );
            } else {
              throw cleanupError;
            }
          }
        }
      }

      const completed = index + 1;
      await setItemStatus(
        operation.id,
        item.id,
        "running",
        `Completed ${completed}/${app.volumes.length} volume backups.`,
        Math.round((completed / app.volumes.length) * 100),
      );
    }

    await setItemStatus(
      operation.id,
      item.id,
      "succeeded",
      `Backed up ${app.volumes.length} volume${app.volumes.length === 1 ? "" : "s"}.`,
      100,
    );
  }

  invalidateClusterSnapshot();
}

async function runRestoreOperation(operation: OperationRecord) {
  const snapshot = await getClusterSnapshot(true);
  const restoreMode = operation.mode as "in-place" | "clone-workload" | "pvc-only";

  for (const item of operation.items) {
    try {
      const backupSet = snapshot.backupSets.find((entry) => entry.id === item.backupSetId);
      if (!backupSet) {
        await setItemStatus(
          operation.id,
          item.id,
          "failed",
          "The selected backup set is no longer available.",
          0,
        );
        continue;
      }

      if (restoreMode === "clone-workload") {
        const cloneRestoreError = getCloneRestoreValidationError(backupSet);
        if (cloneRestoreError) {
          await setItemStatus(operation.id, item.id, "failed", cloneRestoreError, 100);
          continue;
        }
      } else if (restoreMode === "in-place") {
        const inPlaceRestoreError = getInPlaceRestoreValidationError(backupSet);
        if (inPlaceRestoreError) {
          await setItemStatus(operation.id, item.id, "failed", inPlaceRestoreError, 100);
          continue;
        }
      }

      if (restoreMode === "in-place") {
        await runInPlaceRestoreItem(operation, item, backupSet, snapshot.apps);
        continue;
      }

      const targetNamespace = resolveRestoreTargetNamespace(
        restoreMode,
        backupSet,
        item.namespace,
      );
      const clonePlan =
        restoreMode === "clone-workload"
          ? await prepareCloneWorkloadPlan(backupSet, targetNamespace)
          : undefined;

      await ensureNamespace(targetNamespace);
      await setItemStatus(
        operation.id,
        item.id,
        "running",
        `Restoring ${backupSet.volumeCount} volume${backupSet.volumeCount === 1 ? "" : "s"} into ${targetNamespace}.`,
        5,
      );

      const claimNameMap = new Map<string, string>();

      for (const [index, backup] of backupSet.volumes.entries()) {
        const restoredVolumeName = buildName(
          backup.workloadName || backup.volumeName,
          "restore",
          shortId(),
          String(index + 1),
        );
        const restoredPvName = buildName(restoredVolumeName, "pv");
        const { restoredPvcName, templateClaimMatch } = resolveRestoredClaim(
          backup,
          clonePlan,
        );

        await updateItem(operation.id, item.id, (entry) => {
          entry.volumes[index] = {
            volumeName: backup.volumeName,
            pvcName: backup.pvcName,
            restoredVolumeName,
            restoredClaimName: restoredPvcName,
            restoredNamespace: targetNamespace,
            progress: 10,
            status: "running",
          };
        });

        await logItem(
          operation.id,
          item.id,
          `Creating restored Longhorn volume ${restoredVolumeName}.`,
        );

        await createRestoredVolume(backup, restoredVolumeName);
        await createRestoredClaim(
          targetNamespace,
          restoredVolumeName,
          restoredPvName,
          restoredPvcName,
          backup,
        );

        await updateItem(operation.id, item.id, (entry) => {
          const volumeState = entry.volumes[index];
          volumeState.progress = 100;
          volumeState.status = "succeeded";
        });

        if (backup.pvcName) {
          claimNameMap.set(backup.pvcName, restoredPvcName);
        }
        if (clonePlan?.kind === "StatefulSet" && templateClaimMatch) {
          const restoredClaimsForOrdinal =
            clonePlan.restoredTemplateClaims.get(templateClaimMatch.ordinal) ?? new Set<string>();
          restoredClaimsForOrdinal.add(templateClaimMatch.templateClaimName);
          clonePlan.restoredTemplateClaims.set(
            templateClaimMatch.ordinal,
            restoredClaimsForOrdinal,
          );
        }
      }

      if (restoreMode === "clone-workload") {
        if (!clonePlan) {
          throw new Error("Clone restore is missing its source workload details.");
        }

        const cloneResult =
          clonePlan.kind === "StatefulSet"
            ? await cloneStatefulSet(clonePlan, claimNameMap)
            : await cloneDeployment(clonePlan, claimNameMap);

        for (const note of cloneResult.notes) {
          await logItem(operation.id, item.id, note);
        }

        await setItemStatus(
          operation.id,
          item.id,
          "succeeded",
          cloneResult.kind === "StatefulSet"
            ? `Restored into ${targetNamespace} as StatefulSet ${cloneResult.name}${
                typeof cloneResult.replicas === "number"
                  ? ` (${cloneResult.replicas} replica${cloneResult.replicas === 1 ? "" : "s"}).`
                  : "."
              }`
            : `Restored into ${targetNamespace} as deployment ${cloneResult.name}.`,
          100,
        );
        await logItem(
          operation.id,
          item.id,
          `Created cloned ${cloneResult.kind === "StatefulSet" ? "StatefulSet" : "deployment"} ${cloneResult.name} in ${targetNamespace}.`,
        );
        continue;
      }

      await setItemStatus(
        operation.id,
        item.id,
        "succeeded",
        `Restored PVCs into ${targetNamespace}.`,
        100,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected restore failure.";
      await patchOperation(operation.id, (entry) => {
        const operationItem = entry.items.find((candidate) => candidate.id === item.id);
        if (!operationItem) {
          return;
        }

        markInterruptedItem(operationItem, message);
      });
    }
  }

  invalidateClusterSnapshot();
}

async function runOperation(operationId: string) {
  await patchOperation(operationId, (operation) => {
    operation.status = "running";
    operation.startedAt = operation.startedAt || now();
  });

  const operation = await getOperationRecord(operationId);
  if (!operation) {
    return;
  }

  try {
    if (operation.type === "backup") {
      await runBackupOperation(operation);
    } else {
      await runRestoreOperation(operation);
    }

    await patchOperation(operationId, (entry) => {
      entry.status = entry.items.some((item) => item.status === "failed")
        ? "failed"
        : "succeeded";
      entry.finishedAt = now();
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected operation failure";
    await patchOperation(operationId, (entry) => {
      for (const item of entry.items) {
        markInterruptedItem(item, message);
      }
      entry.status = getCompletedOperationStatus(entry.items);
      entry.finishedAt = now();
    });
    throw error;
  } finally {
    invalidateClusterSnapshot();
  }
}

async function getOperationRecord(operationId: string) {
  const operations = await listOperations();
  return operations.find((entry) => entry.id === operationId);
}

export async function createOperation(
  request: CreateOperationRequest,
  requestedBy: string,
) {
  const snapshot = await getClusterSnapshot();
  const operationId = `op-${shortId()}-${Date.now().toString(36)}`;

  const items: OperationItem[] =
    request.type === "backup"
      ? request.appRefs.map((appRef) => {
          const app = snapshot.apps.find((entry) => entry.ref === appRef);
          return {
            id: `item-${shortId()}`,
            displayName: app?.displayName || appRef,
            namespace: app?.namespace,
            kind: app?.kind,
            resourceName: app?.name,
            appRef,
            status: "queued",
            progress: 0,
            logs: [],
            volumes: [],
          };
        })
      : request.backupSetIds.map((backupSetId) => {
          const backupSet = snapshot.backupSets.find((entry) => entry.id === backupSetId);
          return {
            id: `item-${shortId()}`,
            displayName: backupSet?.displayName || backupSetId,
            namespace: resolveRestoreTargetNamespace(
              request.restoreMode,
              backupSet,
              request.targetNamespace,
            ),
            kind: backupSet?.workloadKind,
            resourceName: backupSet?.workloadName,
            backupSetId,
            status: "queued",
            progress: 0,
            logs: [],
            volumes: new Array(backupSet?.volumes.length || 0).fill(null).map(() => ({
              volumeName: "",
              progress: 0,
              status: "queued",
            })),
          };
        });

  const operation: OperationRecord = {
    id: operationId,
    type: request.type,
    status: "queued",
    mode: request.type === "backup" ? request.mode : request.restoreMode,
    requestedBy,
    createdAt: now(),
    summary: getOperationSummary(request),
    items,
  };

  await upsertOperation(operation);
  return operation;
}

function buildRecurringJobObject(
  schedule: Pick<
    ScheduleDefinition,
    "id" | "name" | "cron" | "appRefs" | "enabled" | "createdAt" | "updatedAt" | "lastRunAt"
  >,
  current?: LonghornObject,
): LonghornObject {
  const spec = current?.spec ?? {};
  const currentLabels =
    spec.labels && typeof spec.labels === "object"
      ? (spec.labels as Record<string, string>)
      : {};

  return {
    ...current,
    apiVersion: "longhorn.io/v1beta2",
    kind: "RecurringJob",
    metadata: {
      ...current?.metadata,
      name: schedule.id,
      labels: {
        ...getLonghornObjectLabels(current ?? {}),
        [ORBIT_MANAGED_BY_LABEL]: ORBIT_MANAGED_BY_VALUE,
        [ORBIT_SCHEDULE_MARKER_LABEL]: "true",
      },
      annotations: {
        ...getLonghornObjectAnnotations(current ?? {}),
        ...buildScheduleAnnotations(schedule),
      },
    },
    spec: {
      ...spec,
      name: schedule.id,
      cron: schedule.cron,
      task: "backup",
      retain: getPositiveInteger(spec.retain, RECURRING_JOB_RETAIN),
      concurrency: getPositiveInteger(spec.concurrency, RECURRING_JOB_CONCURRENCY),
      labels: {
        ...currentLabels,
        ...buildRecurringJobBackupLabels(schedule.id, schedule.name),
      },
    },
  };
}

async function syncRecurringJobVolumeAssignments(
  scheduleId: string,
  appRefs: string[],
  enabled: boolean,
  apps?: AppInventoryItem[],
  longhornVolumes?: LonghornObject[],
) {
  const resolvedApps = apps ?? (await getClusterSnapshot(true)).apps;
  const volumes = longhornVolumes ?? (await listLonghornObjects("volumes"));
  const assignmentLabel = getRecurringJobAssignmentLabel(scheduleId);
  const targetVolumeNames = enabled
    ? getResolvedScheduleVolumeNames(resolvedApps, appRefs)
    : new Set<string>();

  for (const volume of volumes) {
    const volumeName = volume.metadata?.name;
    if (!volumeName) {
      continue;
    }

    const labels = getLonghornObjectLabels(volume);
    const isAssigned = labels[assignmentLabel] === "enabled";
    const shouldBeAssigned = targetVolumeNames.has(volumeName);
    if (isAssigned === shouldBeAssigned) {
      continue;
    }

    const nextLabels = {
      ...labels,
    };
    if (shouldBeAssigned) {
      nextLabels[assignmentLabel] = "enabled";
    } else {
      delete nextLabels[assignmentLabel];
    }

    const nextVolume: LonghornObject = {
      ...volume,
      metadata: {
        ...volume.metadata,
        labels: nextLabels,
      },
    };

    await replaceLonghornObject("volumes", volumeName, nextVolume);
    volume.metadata = nextVolume.metadata;
  }
}

function buildScheduleDefinition(
  recurringJob: LonghornObject,
  apps: AppInventoryItem[],
  appRefByVolumeName: Map<string, string>,
  longhornVolumes: LonghornObject[],
): ScheduleDefinition {
  const annotations = getLonghornObjectAnnotations(recurringJob);
  const recurringJobName = recurringJob.metadata?.name;
  if (!recurringJobName) {
    throw new Error("Recurring job is missing a name.");
  }

  const appRefsFromAnnotations = parseScheduleAppRefs(
    annotations[ORBIT_SCHEDULE_APP_REFS_ANNOTATION],
  );
  const assignmentLabel = getRecurringJobAssignmentLabel(recurringJobName);
  const assignedVolumeNames = longhornVolumes
    .filter((volume) => getLonghornObjectLabels(volume)[assignmentLabel] === "enabled")
    .map((volume) => volume.metadata?.name)
    .filter((volumeName): volumeName is string => Boolean(volumeName));
  const activeAppRefs = [...new Set(
    assignedVolumeNames
      .map((volumeName) => appRefByVolumeName.get(volumeName))
      .filter((appRef): appRef is string => Boolean(appRef)),
  )];
  const appRefs = appRefsFromAnnotations.length > 0 ? appRefsFromAnnotations : activeAppRefs;
  const appByRef = new Map(apps.map((app) => [app.ref, app]));
  const cron =
    typeof recurringJob.spec?.cron === "string" ? recurringJob.spec.cron : "";
  const enabled =
    getBooleanAnnotation(annotations[ORBIT_SCHEDULE_ENABLED_ANNOTATION]) ??
    assignedVolumeNames.length > 0;
  const createdAt =
    annotations[ORBIT_SCHEDULE_CREATED_AT_ANNOTATION] ||
    recurringJob.metadata?.creationTimestamp ||
    now();
  const updatedAt =
    annotations[ORBIT_SCHEDULE_UPDATED_AT_ANNOTATION] ||
    recurringJob.metadata?.creationTimestamp ||
    createdAt;

  return {
    id: recurringJobName,
    name: annotations[ORBIT_SCHEDULE_NAME_ANNOTATION] || recurringJobName,
    cron,
    enabled,
    appRefs,
    appDisplayNames: appRefs.map((appRef) => appByRef.get(appRef)?.displayName ?? appRef),
    activeAppRefs,
    activeVolumeCount: assignedVolumeNames.length,
    backend: "longhorn-recurringjob",
    nextRunAt: enabled ? getNextRunAtSafe(cron) : undefined,
    lastRunAt: annotations[ORBIT_SCHEDULE_LAST_RUN_AT_ANNOTATION],
    createdAt,
    updatedAt,
  };
}

export async function listSchedules() {
  const [snapshot, recurringJobs, longhornVolumes] = await Promise.all([
    getClusterSnapshot(),
    listLonghornObjects("recurringjobs"),
    listLonghornObjects("volumes"),
  ]);

  const appRefByVolumeName = new Map<string, string>();
  for (const app of snapshot.apps) {
    for (const volume of app.volumes) {
      appRefByVolumeName.set(volume.longhornVolumeName, app.ref);
    }
  }

  return recurringJobs
    .filter((recurringJob) => recurringJob.metadata?.name && isOrbitManagedSchedule(recurringJob))
    .map((recurringJob) =>
      buildScheduleDefinition(recurringJob, snapshot.apps, appRefByVolumeName, longhornVolumes),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function reconcileManagedSchedules() {
  const [snapshot, recurringJobs, longhornVolumes] = await Promise.all([
    getClusterSnapshot(true),
    listLonghornObjects("recurringjobs"),
    listLonghornObjects("volumes"),
  ]);

  const managedJobs = recurringJobs.filter(
    (recurringJob) => recurringJob.metadata?.name && isOrbitManagedSchedule(recurringJob),
  );

  for (const recurringJob of managedJobs) {
    const annotations = getLonghornObjectAnnotations(recurringJob);
    await syncRecurringJobVolumeAssignments(
      recurringJob.metadata?.name ?? "",
      parseScheduleAppRefs(annotations[ORBIT_SCHEDULE_APP_REFS_ANNOTATION]),
      getBooleanAnnotation(annotations[ORBIT_SCHEDULE_ENABLED_ANNOTATION]) ?? true,
      snapshot.apps,
      longhornVolumes,
    );
  }

  return managedJobs.length;
}

export async function migratePersistedSchedules() {
  const persistedSchedules = await listPersistedSchedules();
  if (persistedSchedules.length === 0) {
    return [];
  }

  const migratedIds: string[] = [];

  for (const schedule of persistedSchedules) {
    const existingRecurringJob = await getLonghornObject("recurringjobs", schedule.id);
    if (!existingRecurringJob) {
      getNextRunAt(schedule.cron);
      await createLonghornObject(
        buildRecurringJobObject(schedule),
        "recurringjobs",
      );
      await syncRecurringJobVolumeAssignments(
        schedule.id,
        schedule.appRefs,
        schedule.enabled,
      );
    }

    await deletePersistedSchedule(schedule.id);
    migratedIds.push(schedule.id);
  }

  return migratedIds;
}

export async function createSchedule(
  input: { name: string; cron: string; appRefs: string[] },
) {
  const scheduleId = buildRecurringJobName(input.name.trim());
  const createdAt = now();
  const cron = input.cron.trim();
  getNextRunAt(cron);

  const schedule: ScheduleDefinition = {
    id: scheduleId,
    name: input.name.trim(),
    cron,
    appRefs: [...new Set(input.appRefs)],
    enabled: true,
    createdAt,
    updatedAt: createdAt,
    nextRunAt: getNextRunAt(cron),
  };

  await createLonghornObject(buildRecurringJobObject(schedule), "recurringjobs");
  await syncRecurringJobVolumeAssignments(schedule.id, schedule.appRefs, schedule.enabled);

  return (
    (await listSchedules()).find((entry) => entry.id === schedule.id) ?? schedule
  );
}

export async function updateSchedule(update: UpdateScheduleRequest) {
  const current = await getLonghornObject("recurringjobs", update.id);
  if (!current || !isOrbitManagedSchedule(current)) {
    throw new Error("Schedule not found.");
  }

  const annotations = getLonghornObjectAnnotations(current);
  const currentCron =
    typeof current.spec?.cron === "string" ? current.spec.cron : "";
  const nextCron = update.cron?.trim() || currentCron;
  getNextRunAt(nextCron);

  const schedule: ScheduleDefinition = {
    id: update.id,
    name: update.name?.trim() || annotations[ORBIT_SCHEDULE_NAME_ANNOTATION] || update.id,
    cron: nextCron,
    appRefs: update.appRefs
      ? [...new Set(update.appRefs)]
      : parseScheduleAppRefs(annotations[ORBIT_SCHEDULE_APP_REFS_ANNOTATION]),
    enabled:
      update.enabled ??
      getBooleanAnnotation(annotations[ORBIT_SCHEDULE_ENABLED_ANNOTATION]) ??
      true,
    createdAt:
      annotations[ORBIT_SCHEDULE_CREATED_AT_ANNOTATION] ||
      current.metadata?.creationTimestamp ||
      now(),
    updatedAt: now(),
    lastRunAt: annotations[ORBIT_SCHEDULE_LAST_RUN_AT_ANNOTATION],
    nextRunAt: undefined,
  };

  await replaceLonghornObject(
    "recurringjobs",
    update.id,
    buildRecurringJobObject(schedule, current),
  );
  await syncRecurringJobVolumeAssignments(schedule.id, schedule.appRefs, schedule.enabled);

  const updatedSchedule = (await listSchedules()).find((entry) => entry.id === schedule.id);
  if (!updatedSchedule) {
    throw new Error("Schedule not found after update.");
  }

  return updatedSchedule;
}

export async function removeSchedule(input: DeleteScheduleRequest) {
  const current = await getLonghornObject("recurringjobs", input.id);
  if (current && !isOrbitManagedSchedule(current)) {
    throw new Error("Schedule not found.");
  }

  await syncRecurringJobVolumeAssignments(input.id, [], false);
  await deleteLonghornObject("recurringjobs", input.id);
  await deletePersistedSchedule(input.id);
}

export async function syncBackupTarget(input: {
  backupTargetURL: string;
  credentialSecret: string;
  pollInterval: string;
}) {
  const current = await getLonghornObject("backuptargets", "default");
  if (!current) {
    throw new Error("The Longhorn default backup target does not exist.");
  }

  const next: LonghornObject = {
    ...current,
    spec: {
      ...current.spec,
      backupTargetURL: input.backupTargetURL,
      credentialSecret: input.credentialSecret,
      pollInterval: input.pollInterval,
      syncRequestedAt: now(),
    },
  };

  await replaceLonghornObject("backuptargets", "default", next);
  invalidateClusterSnapshot();
}

export async function processQueuedOperations() {
  const operations = await listOperations();
  const next = operations
    .filter((operation) => operation.status === "queued")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];

  if (!next) {
    return false;
  }

  try {
    await runOperation(next.id);
  } catch (error) {
    console.error(error);
  }

  return true;
}

export async function reconcilePersistedOperations() {
  const operations = await listOperations();
  const runningOperations = operations.filter((operation) => operation.status === "running");

  if (runningOperations.length === 0) {
    return [];
  }

  const interruptionMessage =
    "Operation interrupted by backup UI restart. Review partial results and retry if needed.";

  for (const operation of runningOperations) {
    await patchOperation(operation.id, (entry) => {
      const updatedItem = entry.items.some((item) =>
        markInterruptedItem(item, interruptionMessage),
      );
      entry.status = updatedItem
        ? "failed"
        : getCompletedOperationStatus(entry.items);
      entry.finishedAt = entry.finishedAt || now();
    });
  }

  return runningOperations.map((operation) => operation.id);
}
