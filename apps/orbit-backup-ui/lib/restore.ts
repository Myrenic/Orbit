import type { BackupSetSummary } from "@/lib/types";

export const CLONE_RESTORE_SUPPORTED_WORKLOAD_KINDS = [
  "Deployment",
  "StatefulSet",
] as const;

type CloneRestoreBackupSet = Pick<
  BackupSetSummary,
  "displayName" | "namespace" | "volumes" | "workloadKind" | "workloadName"
>;

function formatSupportedKinds() {
  return CLONE_RESTORE_SUPPORTED_WORKLOAD_KINDS.join(" and ");
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
