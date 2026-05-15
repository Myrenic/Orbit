export type WorkloadKind = "Deployment" | "StatefulSet" | "DaemonSet";
export type OperationType = "backup" | "restore";
export type OperationStatus = "queued" | "running" | "succeeded" | "failed";
export type OperationItemStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";
export type RestoreMode = "in-place" | "clone-workload" | "pvc-only";
export type BackupMode = "incremental" | "full";

export interface UserSummary {
  user?: string;
  email?: string;
  preferredUsername?: string;
  groups: string[];
}

export interface PodSummary {
  name: string;
  phase: string;
  ready: boolean;
  restarts: number;
}

export interface AppVolume {
  pvcName: string;
  pvName?: string;
  longhornVolumeName: string;
  size?: string;
  accessModes: string[];
  longhornAccessMode?: string;
  storageClassName?: string;
  fsType?: string;
  numberOfReplicas?: number;
  frontend?: string;
  dataEngine?: string;
  lastBackup?: string;
  lastBackupAt?: string;
}

export interface AppInventoryItem {
  ref: string;
  namespace: string;
  kind: WorkloadKind;
  name: string;
  displayName: string;
  status: "healthy" | "degraded" | "stopped";
  podCount: number;
  readyPodCount: number;
  podNames: string[];
  pods: PodSummary[];
  claimNames: string[];
  volumes: AppVolume[];
}

export type UnmanagedResourceKind =
  | WorkloadKind
  | "Pod"
  | "Service"
  | "PersistentVolumeClaim";

export type UnmanagedConfidence = "high" | "review";
export type UnmanagedSource = "restore-artifact" | "manual-review";

export interface UnmanagedReason {
  summary: string;
  detail: string;
}

export interface UnmanagedInventoryItem {
  ref: string;
  namespace: string;
  kind: UnmanagedResourceKind;
  name: string;
  displayName: string;
  confidence: UnmanagedConfidence;
  source: UnmanagedSource;
  createdAt?: string;
  managementSummary: string;
  reasons: UnmanagedReason[];
  podCount: number;
  readyPodCount: number;
  pods: PodSummary[];
}

export interface CleanupUnmanagedRequest {
  refs: string[];
}

export interface CleanupUnmanagedResultItem {
  ref: string;
  displayName: string;
}

export interface CleanupUnmanagedSkippedItem extends CleanupUnmanagedResultItem {
  reason: string;
}

export interface CleanupUnmanagedResponse {
  deleted: CleanupUnmanagedResultItem[];
  skipped: CleanupUnmanagedSkippedItem[];
}

export interface BackupEntry {
  name: string;
  setId: string;
  volumeName: string;
  pvcName?: string;
  namespace?: string;
  workloadKind?: WorkloadKind;
  workloadName?: string;
  appDisplayName?: string;
  currentAppRef?: string;
  createdAt?: string;
  state: string;
  progress: number;
  url?: string;
  volumeSize?: string;
  snapshotName?: string;
  requestedBy?: string;
  labels: Record<string, string>;
}

export interface BackupSetSummary {
  id: string;
  displayName: string;
  namespace?: string;
  workloadKind?: WorkloadKind;
  workloadName?: string;
  currentAppRef?: string;
  createdAt?: string;
  state: string;
  volumeCount: number;
  requestedBy?: string;
  podCount: number;
  readyPodCount: number;
  podNames: string[];
  pods: PodSummary[];
  cloneRestoreSupported: boolean;
  cloneRestoreBlockedReason?: string;
  volumes: BackupEntry[];
}

export interface BackupTargetSummary {
  name: string;
  backupTargetURL?: string;
  credentialSecret?: string;
  pollInterval?: string;
  available: boolean;
  lastSyncedAt?: string;
  conditions: string[];
}

export interface OperationLogEntry {
  timestamp: string;
  level: "info" | "error";
  message: string;
}

export interface OperationItemVolumeState {
  volumeName: string;
  pvcName?: string;
  snapshotName?: string;
  backupName?: string;
  restoredVolumeName?: string;
  restoredClaimName?: string;
  restoredNamespace?: string;
  progress: number;
  status: OperationItemStatus;
  message?: string;
}

export interface OperationItem {
  id: string;
  displayName: string;
  namespace?: string;
  kind?: WorkloadKind;
  resourceName?: string;
  appRef?: string;
  backupSetId?: string;
  status: OperationItemStatus;
  progress: number;
  message?: string;
  logs: OperationLogEntry[];
  volumes: OperationItemVolumeState[];
}

export interface OperationRecord {
  id: string;
  type: OperationType;
  status: OperationStatus;
  mode?: BackupMode | RestoreMode;
  requestedBy: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  summary: string;
  items: OperationItem[];
}

export interface ScheduleDefinition {
  id: string;
  name: string;
  cron: string;
  timezone?: string;
  retain: number;
  enabled: boolean;
  appRefs: string[];
  appDisplayNames?: string[];
  activeAppRefs?: string[];
  activeVolumeCount?: number;
  backend?: "longhorn-recurringjob";
  nextRunAt?: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedState {
  operations: OperationRecord[];
  schedules: ScheduleDefinition[];
  pbs?: PersistedPbsState;
  destinations?: BackupDestinationPreferences;
}

export interface OverviewStats {
  workloadCount: number;
  protectedWorkloadCount: number;
  backupSetCount: number;
  runningOperations: number;
  targetHealthy: boolean;
}

export interface DashboardPayload {
  user: UserSummary;
  overview: OverviewStats;
  recentOperations: OperationRecord[];
  schedules: ScheduleDefinition[];
  targets: BackupTargetSummary[];
}

export interface BackupOperationRequest {
  type: "backup";
  appRefs: string[];
  mode: BackupMode;
}

export interface RestoreOperationRequest {
  type: "restore";
  backupSetIds: string[];
  restoreMode: RestoreMode;
  targetNamespace?: string;
}

export type CreateOperationRequest =
  | BackupOperationRequest
  | RestoreOperationRequest;

export interface CreateScheduleRequest {
  name: string;
  cron: string;
  appRefs: string[];
  retain?: number;
}

export interface UpdateScheduleRequest {
  id: string;
  enabled?: boolean;
  name?: string;
  cron?: string;
  appRefs?: string[];
  retain?: number;
}

export interface DeleteScheduleRequest {
  id: string;
}

export interface PurgeBackupSetsRequest {
  setIds: string[];
}

export interface PurgeBackupSetResultItem {
  id: string;
  displayName: string;
}

export interface PurgeBackupSetSkippedItem extends PurgeBackupSetResultItem {
  reason: string;
}

export interface PurgeBackupSetsResponse {
  deleted: PurgeBackupSetResultItem[];
  skipped: PurgeBackupSetSkippedItem[];
}

export interface PbsConfig {
  enabled: boolean;
  server: string;
  datastore: string;
  username: string;
  password?: string;
  fingerprint?: string;
  backupId: string;
  keepLast: number;
  archiveOnBackup: boolean;
  updatedAt: string;
}

export interface PersistedPbsState {
  config?: PbsConfig;
  lastValidatedAt?: string;
  lastArchiveAt?: string;
  lastArchiveError?: string;
}

export interface PbsSnapshotSummary {
  id: string;
  backupTime: string;
  size?: number;
  protected: boolean;
}

export interface PbsStatusSummary {
  configured: boolean;
  enabled: boolean;
  reachable: boolean;
  server?: string;
  datastore?: string;
  username?: string;
  backupId?: string;
  fingerprint?: string;
  keepLast?: number;
  archiveOnBackup: boolean;
  passwordConfigured: boolean;
  lastValidatedAt?: string;
  lastArchiveAt?: string;
  lastArchiveError?: string;
  error?: string;
  snapshots: PbsSnapshotSummary[];
}

export interface UpdatePbsConfigRequest {
  enabled: boolean;
  server: string;
  datastore: string;
  username: string;
  password?: string;
  fingerprint?: string;
  backupId?: string;
  keepLast?: number;
  archiveOnBackup?: boolean;
}

export interface PbsActionRequest {
  action: "test" | "archive" | "prune";
}

export interface BackupDestinationPreferences {
  longhornEnabled: boolean;
  updatedAt: string;
}

export interface UpdateBackupDestinationRequest {
  longhornEnabled: boolean;
}
