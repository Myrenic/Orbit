import type { BackupSetSummary, RestoreMode } from "@/lib/types";

const DNS_LABEL_MAX_LENGTH = 63;
const DNS_LABEL_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const RESTORE_NAMESPACE_FALLBACK = "services";
const CLONE_RESTORE_NAMESPACE_SUFFIX = "restore";
const RESTORE_MODES: RestoreMode[] = ["clone-workload", "pvc-only"];

export const CLONE_RESTORE_SUPPORTED_WORKLOAD_KINDS = [
  "Deployment",
  "StatefulSet",
] as const;

type CloneRestoreBackupSet = Pick<
  BackupSetSummary,
  "displayName" | "namespace" | "volumes" | "workloadKind" | "workloadName"
>;

type RestoreNamespaceBackupSet = Pick<BackupSetSummary, "namespace"> | undefined;

function sanitizeDnsLabel(value: string, maxLength = DNS_LABEL_MAX_LENGTH) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized.slice(0, maxLength).replace(/-$/, "");
}

function buildRestoreNamespace(baseName: string, suffix?: string) {
  if (!suffix) {
    return sanitizeDnsLabel(baseName) || RESTORE_NAMESPACE_FALLBACK;
  }

  const normalizedSuffix = sanitizeDnsLabel(suffix);
  if (!normalizedSuffix) {
    return sanitizeDnsLabel(baseName) || RESTORE_NAMESPACE_FALLBACK;
  }

  const maxBaseLength = DNS_LABEL_MAX_LENGTH - normalizedSuffix.length - 1;
  const normalizedBase =
    sanitizeDnsLabel(baseName, maxBaseLength) || RESTORE_NAMESPACE_FALLBACK;

  return `${normalizedBase}-${normalizedSuffix}`;
}

function formatSupportedKinds() {
  return CLONE_RESTORE_SUPPORTED_WORKLOAD_KINDS.join(" and ");
}

export function isRestoreMode(value: unknown): value is RestoreMode {
  return typeof value === "string" && RESTORE_MODES.includes(value as RestoreMode);
}

export function normalizeRestoreTargetNamespace(targetNamespace?: string) {
  const normalized = targetNamespace?.trim();
  return normalized ? normalized : undefined;
}

export function getRestoreTargetNamespaceValidationError(targetNamespace?: string) {
  const normalized = normalizeRestoreTargetNamespace(targetNamespace);
  if (!normalized) {
    return undefined;
  }

  if (
    normalized.length > DNS_LABEL_MAX_LENGTH ||
    !DNS_LABEL_PATTERN.test(normalized)
  ) {
    return "Restore namespace must be a valid lowercase Kubernetes namespace (DNS-1123 label).";
  }

  return undefined;
}

export function getDefaultRestoreTargetNamespace(
  restoreMode: RestoreMode,
  backupSet: RestoreNamespaceBackupSet,
) {
  const baseName = backupSet?.namespace || RESTORE_NAMESPACE_FALLBACK;

  if (restoreMode === "clone-workload") {
    return buildRestoreNamespace(baseName, CLONE_RESTORE_NAMESPACE_SUFFIX);
  }

  return buildRestoreNamespace(baseName);
}

export function resolveRestoreTargetNamespace(
  restoreMode: RestoreMode,
  backupSet: RestoreNamespaceBackupSet,
  targetNamespace?: string,
) {
  return (
    normalizeRestoreTargetNamespace(targetNamespace) ??
    getDefaultRestoreTargetNamespace(restoreMode, backupSet)
  );
}

export function getCloneRestoreValidationError(
  backupSet: CloneRestoreBackupSet,
): string | undefined {
  if (!backupSet.namespace || !backupSet.workloadName) {
    return "Clone restore needs the original namespace and workload name. Restore this backup as PVCs instead.";
  }

  if (backupSet.workloadKind === "Deployment") {
    return undefined;
  }

  if (backupSet.workloadKind === "StatefulSet") {
    if (backupSet.volumes.some((volume) => !volume.pvcName)) {
      return "StatefulSet clone restore needs PVC names for every backed up volume. Restore this backup as PVCs instead.";
    }

    return undefined;
  }

  if (!backupSet.workloadKind) {
    return "Clone restore needs the original workload kind. Restore this backup as PVCs instead.";
  }

  return `Clone restore supports ${formatSupportedKinds()} workloads. Restore this ${backupSet.workloadKind} backup as PVCs instead.`;
}

export function getCloneRestoreSupportState(backupSet: CloneRestoreBackupSet) {
  const blockedReason = getCloneRestoreValidationError(backupSet);

  return {
    supported: !blockedReason,
    blockedReason,
  };
}

export function getCloneRestoreBatchValidationError(
  backupSets: CloneRestoreBackupSet[],
) {
  const blockedBackups = backupSets.flatMap((backupSet) => {
    const blockedReason = getCloneRestoreValidationError(backupSet);
    return blockedReason ? [`${backupSet.displayName}: ${blockedReason}`] : [];
  });

  if (blockedBackups.length === 0) {
    return undefined;
  }

  if (blockedBackups.length === 1) {
    return blockedBackups[0];
  }

  return `Clone restore is not available for all selected backups. ${blockedBackups.join(" ")}`;
}
