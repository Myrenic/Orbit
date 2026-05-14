import { getBackupTargets } from "@/lib/cluster";
import { getBackupDestinationPreferences, updateBackupDestinationPreferences } from "@/lib/store";
import type { BackupDestinationPreferences, UpdateBackupDestinationRequest } from "@/lib/types";

function now() {
  return new Date().toISOString();
}

export function getDefaultBackupDestinationPreferences(): BackupDestinationPreferences {
  return {
    longhornEnabled: true,
    updatedAt: now(),
  };
}

export async function readBackupDestinationPreferences() {
  return (await getBackupDestinationPreferences()) ?? getDefaultBackupDestinationPreferences();
}

export async function saveBackupDestinationPreferences(
  input: UpdateBackupDestinationRequest,
) {
  return updateBackupDestinationPreferences((current) => ({
    ...(current ?? getDefaultBackupDestinationPreferences()),
    longhornEnabled: Boolean(input.longhornEnabled),
    updatedAt: now(),
  }));
}

export async function getBackupDestinationState() {
  const [preferences, targets] = await Promise.all([
    readBackupDestinationPreferences(),
    getBackupTargets(),
  ]);
  const defaultTarget = targets.find((target) => target.name === "default") ?? targets[0];

  return {
    longhornEnabled: preferences.longhornEnabled,
    updatedAt: preferences.updatedAt,
    longhornTarget: defaultTarget,
  };
}
