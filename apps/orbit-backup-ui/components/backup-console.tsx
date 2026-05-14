"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Cloud,
  DatabaseBackup,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Workflow,
} from "lucide-react";

import { getCloneRestoreBatchValidationError } from "@/lib/restore";
import type {
  AppInventoryItem,
  BackupMode,
  BackupSetSummary,
  DashboardPayload,
  OperationItem,
  OperationRecord,
  PodSummary,
  RestoreMode,
  ScheduleDefinition,
} from "@/lib/types";

type UiState = {
  dashboard?: DashboardPayload;
  apps: AppInventoryItem[];
  backupSets: BackupSetSummary[];
  operations: OperationRecord[];
  loading: boolean;
  error?: string;
};

type Notice = {
  tone: "success" | "error";
  title: string;
  description: string;
};

type SectionHeadingProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
};

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

type WorkloadPodPanelProps = {
  pods: PodSummary[];
  podCount: number;
  readyPodCount: number;
  emptyMessage: string;
  workloadLabel?: string;
};

type AppSelectionCardProps = {
  app: AppInventoryItem;
  selected: boolean;
  onToggle: () => void;
};

type BackupSetCardProps = {
  backupSet: BackupSetSummary;
  selected: boolean;
  onToggle: () => void;
};

type SkeletonPanelProps = {
  className?: string;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatTimestamp(value?: string) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function statusClass(status: string) {
  switch (status) {
    case "healthy":
    case "Completed":
    case "succeeded":
      return "bg-emerald-400";
    case "running":
    case "queued":
    case "InProgress":
      return "bg-sky-400";
    case "stopped":
    case "skipped":
      return "bg-slate-500";
    default:
      return "bg-rose-400";
  }
}

function badgeClass(status: string) {
  switch (status) {
    case "healthy":
    case "Completed":
    case "succeeded":
      return "border-emerald-400/25 bg-emerald-400/10 text-emerald-100";
    case "running":
    case "queued":
    case "InProgress":
      return "border-sky-400/25 bg-sky-400/10 text-sky-100";
    case "stopped":
    case "skipped":
      return "border-slate-400/25 bg-slate-400/10 text-slate-200";
    default:
      return "border-rose-400/25 bg-rose-400/10 text-rose-100";
  }
}

function getPodTone(pod: PodSummary) {
  if (pod.ready) {
    return {
      badge: badgeClass("healthy"),
      dot: statusClass("healthy"),
      label: "Ready",
    };
  }

  if (pod.phase === "Running") {
    return {
      badge: badgeClass("running"),
      dot: statusClass("running"),
      label: pod.phase,
    };
  }

  if (pod.phase === "Pending") {
    return {
      badge: badgeClass("queued"),
      dot: statusClass("queued"),
      label: pod.phase,
    };
  }

  if (pod.phase === "Succeeded") {
    return {
      badge: badgeClass("succeeded"),
      dot: statusClass("succeeded"),
      label: pod.phase,
    };
  }

  return {
    badge: badgeClass("failed"),
    dot: statusClass("failed"),
    label: pod.phase || "Unknown",
  };
}

function getWorkloadLabel(namespace?: string, kind?: string, name?: string) {
  return [namespace, kind, name].filter(Boolean).join("/");
}

function averageProgress(items: OperationItem[]) {
  if (items.length === 0) {
    return 0;
  }

  return Math.round(items.reduce((sum, item) => sum + item.progress, 0) / items.length);
}

function SectionHeading({ eyebrow, title, description, actions }: SectionHeadingProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? <div className="section-label">{eyebrow}</div> : null}
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-white sm:text-2xl">
          {title}
        </h2>
        {description ? <p className="mt-2 text-sm text-slate-400 sm:text-[15px]">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}

function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state rounded-[28px] px-5 py-8 text-left">
      <div className="text-base font-semibold text-white">{title}</div>
      <p className="mt-2 max-w-2xl text-sm text-slate-400">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

function SkeletonPanel({ className }: SkeletonPanelProps) {
  return (
    <div className={cn("panel rounded-[28px] p-6", className)}>
      <div className="animate-pulse space-y-4">
        <div className="h-3 w-24 rounded-full bg-slate-800/90" />
        <div className="h-8 w-2/3 rounded-2xl bg-slate-800/80" />
        <div className="h-4 w-full rounded-full bg-slate-900/80" />
        <div className="h-4 w-5/6 rounded-full bg-slate-900/80" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="h-28 rounded-[24px] bg-slate-900/80" />
          <div className="h-28 rounded-[24px] bg-slate-900/80" />
        </div>
      </div>
    </div>
  );
}

function WorkloadPodPanel({
  pods,
  podCount,
  readyPodCount,
  emptyMessage,
  workloadLabel,
}: WorkloadPodPanelProps) {
  const effectivePodCount = Math.max(podCount, pods.length);

  return (
    <div className="rounded-[24px] border border-white/8 bg-slate-950/65 px-4 py-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">
            Live workload pods
          </div>
          {workloadLabel ? (
            <div className="mt-1 break-all text-xs text-slate-500">{workloadLabel}</div>
          ) : null}
        </div>
        <div className="text-xs text-slate-400">
          {effectivePodCount > 0
            ? `${readyPodCount}/${effectivePodCount} ready`
            : "No live pods mapped"}
        </div>
      </div>

      {effectivePodCount > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {pods.map((pod) => {
            const tone = getPodTone(pod);
            return (
              <span
                className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${tone.badge}`}
                key={pod.name}
              >
                <span className={`status-dot shrink-0 ${tone.dot}`} />
                <span className="max-w-[10rem] truncate font-medium text-white sm:max-w-[14rem]">
                  {pod.name}
                </span>
                <span>{tone.label}</span>
                {pod.restarts > 0 ? (
                  <span className="text-amber-200">
                    {pod.restarts} restart{pod.restarts === 1 ? "" : "s"}
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 text-xs text-slate-400">{emptyMessage}</div>
      )}
    </div>
  );
}

function AppSelectionCard({ app, selected, onToggle }: AppSelectionCardProps) {
  const latestBackupAt = app.volumes
    .map((volume) => volume.lastBackupAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];

  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col gap-4 rounded-[28px] border p-5 transition duration-200",
        selected
          ? "border-sky-400/40 bg-sky-400/10 shadow-[0_24px_70px_rgba(14,165,233,0.12)]"
          : "border-slate-800/90 bg-slate-950/55 hover:border-sky-400/25 hover:bg-slate-950/75",
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <input
              checked={selected}
              className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-sky-400"
              onChange={onToggle}
              type="checkbox"
            />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold text-white">{app.displayName}</span>
                <span
                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(
                    app.status,
                  )}`}
                >
                  {app.status}
                </span>
              </div>
              <div className="mt-1 break-all text-xs text-slate-500">
                {getWorkloadLabel(app.namespace, app.kind, app.name)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-slate-300">
            <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1">
              {pluralize(app.volumes.length, "protected volume")}
            </span>
            <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1">
              {app.readyPodCount}/{app.podCount} pods ready
            </span>
            <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1">
              Last backup {latestBackupAt ? formatTimestamp(latestBackupAt) : "not recorded"}
            </span>
          </div>
        </div>

        <div className="rounded-[24px] border border-white/8 bg-slate-900/75 px-4 py-3 sm:min-w-[12rem] sm:text-right">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
            Protection scope
          </div>
          <div className="mt-2 text-2xl font-semibold text-white">{app.volumes.length}</div>
          <div className="text-xs text-slate-400">Longhorn-backed claim{app.volumes.length === 1 ? "" : "s"}</div>
        </div>
      </div>

      <div className="rounded-[24px] border border-white/8 bg-slate-950/65 px-4 py-4">
        <div className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">
          Protected storage
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {app.volumes.map((volume) => (
            <span
              className="rounded-full border border-white/8 bg-white/5 px-3 py-1.5 text-xs text-slate-300"
              key={volume.longhornVolumeName}
            >
              {volume.pvcName}
              {volume.size ? ` · ${volume.size}` : ""} → {volume.longhornVolumeName}
            </span>
          ))}
        </div>
      </div>

      <WorkloadPodPanel
        emptyMessage="Pods will appear here once the workload is scheduled and running."
        podCount={app.podCount}
        pods={app.pods}
        readyPodCount={app.readyPodCount}
        workloadLabel={app.displayName}
      />
    </label>
  );
}

function BackupSetCard({ backupSet, selected, onToggle }: BackupSetCardProps) {
  const workloadLabel =
    getWorkloadLabel(backupSet.namespace, backupSet.workloadKind, backupSet.workloadName) ||
    backupSet.currentAppRef;

  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col gap-4 rounded-[28px] border p-5 transition duration-200",
        selected
          ? "border-violet-400/40 bg-violet-400/10 shadow-[0_24px_70px_rgba(167,139,250,0.12)]"
          : "border-slate-800/90 bg-slate-950/55 hover:border-violet-400/25 hover:bg-slate-950/75",
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <input
              checked={selected}
              className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-violet-400"
              onChange={onToggle}
              type="checkbox"
            />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold text-white">{backupSet.displayName}</span>
                <span
                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(
                    backupSet.state,
                  )}`}
                >
                  {backupSet.state}
                </span>
                <span
                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
                    backupSet.cloneRestoreSupported
                      ? "border-violet-400/25 bg-violet-400/10 text-violet-100"
                      : "border-slate-400/20 bg-slate-400/10 text-slate-200"
                  }`}
                >
                  {backupSet.cloneRestoreSupported ? "Clone ready" : "PVC-only"}
                </span>
              </div>
              {workloadLabel ? (
                <div className="mt-1 break-all text-xs text-slate-500">{workloadLabel}</div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-slate-300">
            <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1">
              {pluralize(backupSet.volumeCount, "captured volume")}
            </span>
            <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1">
              Created {formatTimestamp(backupSet.createdAt)}
            </span>
            {backupSet.requestedBy ? (
              <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1">
                Requested by {backupSet.requestedBy}
              </span>
            ) : null}
          </div>

          {!backupSet.cloneRestoreSupported && backupSet.cloneRestoreBlockedReason ? (
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs text-amber-100">
              {backupSet.cloneRestoreBlockedReason}
            </div>
          ) : null}
        </div>

        <div className="rounded-[24px] border border-white/8 bg-slate-900/75 px-4 py-3 sm:min-w-[12rem] sm:text-right">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Restore scope</div>
          <div className="mt-2 text-2xl font-semibold text-white">{backupSet.volumeCount}</div>
          <div className="text-xs text-slate-400">Volume snapshot{backupSet.volumeCount === 1 ? "" : "s"}</div>
        </div>
      </div>

      <div className="rounded-[24px] border border-white/8 bg-slate-950/65 px-4 py-4">
        <div className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">
          Captured volumes
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {backupSet.volumes.map((volume) => (
            <span
              className="rounded-full border border-white/8 bg-white/5 px-3 py-1.5 text-xs text-slate-300"
              key={volume.name}
            >
              {volume.pvcName || volume.volumeName}
            </span>
          ))}
        </div>
      </div>

      <WorkloadPodPanel
        emptyMessage="No current cluster pods are mapped to this workload."
        podCount={backupSet.podCount}
        pods={backupSet.pods}
        readyPodCount={backupSet.readyPodCount}
        workloadLabel={workloadLabel}
      />
    </label>
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function sendJson<T>(url: string, method: string, body: unknown) {
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export function BackupConsole() {
  const [uiState, setUiState] = useState<UiState>({
    apps: [],
    backupSets: [],
    operations: [],
    loading: true,
  });
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [selectedBackupSets, setSelectedBackupSets] = useState<string[]>([]);
  const [backupMode, setBackupMode] = useState<BackupMode>("incremental");
  const [restoreMode, setRestoreMode] = useState<RestoreMode>("clone-workload");
  const [restoreNamespace, setRestoreNamespace] = useState("");
  const [scheduleName, setScheduleName] = useState("");
  const [scheduleCron, setScheduleCron] = useState("0 3 * * *");
  const [targetUrl, setTargetUrl] = useState("");
  const [targetSecret, setTargetSecret] = useState("");
  const [targetPollInterval, setTargetPollInterval] = useState("300s");
  const [targetDirty, setTargetDirty] = useState(false);
  const [workingLabel, setWorkingLabel] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);

    try {
      const [dashboardResponse, appsResponse, backupResponse, operationsResponse] =
        await Promise.all([
          fetchJson<DashboardPayload>("/api/dashboard"),
          fetchJson<{ apps: AppInventoryItem[] }>("/api/apps"),
          fetchJson<{ backupSets: BackupSetSummary[] }>("/api/backups"),
          fetchJson<{ operations: OperationRecord[] }>("/api/operations"),
        ]);

      setUiState({
        dashboard: dashboardResponse,
        apps: appsResponse.apps,
        backupSets: backupResponse.backupSets,
        operations: operationsResponse.operations,
        loading: false,
      });

      const defaultTarget =
        dashboardResponse.targets.find((target) => target.name === "default") ||
        dashboardResponse.targets[0];
      if (defaultTarget && !targetDirty) {
        setTargetUrl(defaultTarget.backupTargetURL || "");
        setTargetSecret(defaultTarget.credentialSecret || "");
        setTargetPollInterval(defaultTarget.pollInterval || "300s");
      }
    } catch (error) {
      setUiState((previous) => ({
        ...previous,
        error: getErrorMessage(error, "Failed to load the console."),
        loading: false,
      }));
    } finally {
      setIsRefreshing(false);
    }
  }, [targetDirty]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 5_000);

    return () => clearInterval(interval);
  }, [refresh]);

  const protectedApps = useMemo(
    () => uiState.apps.filter((app) => app.volumes.length > 0),
    [uiState.apps],
  );
  const appByRef = useMemo(
    () => new Map(uiState.apps.map((app) => [app.ref, app])),
    [uiState.apps],
  );
  const backupSetById = useMemo(
    () => new Map(uiState.backupSets.map((backupSet) => [backupSet.id, backupSet])),
    [uiState.backupSets],
  );
  const selectedAppRecords = useMemo(
    () =>
      selectedApps
        .map((appRef) => appByRef.get(appRef))
        .filter((app): app is AppInventoryItem => Boolean(app)),
    [appByRef, selectedApps],
  );
  const selectedBackupSetRecords = useMemo(
    () =>
      selectedBackupSets
        .map((backupSetId) => backupSetById.get(backupSetId))
        .filter((backupSet): backupSet is BackupSetSummary => Boolean(backupSet)),
    [backupSetById, selectedBackupSets],
  );
  const cloneRestoreSelectionError = useMemo(
    () =>
      restoreMode === "clone-workload"
        ? getCloneRestoreBatchValidationError(selectedBackupSetRecords)
        : undefined,
    [restoreMode, selectedBackupSetRecords],
  );
  const restoreDisabled =
    selectedBackupSets.length === 0 ||
    workingLabel === "restore" ||
    Boolean(cloneRestoreSelectionError);

  const defaultCloneNamespace = useMemo(() => {
    const selected = uiState.backupSets.find((backupSet) =>
      selectedBackupSets.includes(backupSet.id),
    );
    if (!selected?.namespace) {
      return "services-restore";
    }
    return `${selected.namespace}-restore`;
  }, [selectedBackupSets, uiState.backupSets]);

  useEffect(() => {
    if (!restoreNamespace) {
      setRestoreNamespace(defaultCloneNamespace);
    }
  }, [defaultCloneNamespace, restoreNamespace]);

  useEffect(() => {
    setSelectedApps((previous) => previous.filter((ref) => appByRef.has(ref)));
  }, [appByRef]);

  useEffect(() => {
    setSelectedBackupSets((previous) => previous.filter((id) => backupSetById.has(id)));
  }, [backupSetById]);

  const toggleSelection = (
    selected: string[],
    setSelected: (next: string[]) => void,
    value: string,
  ) => {
    if (selected.includes(value)) {
      setSelected(selected.filter((entry) => entry !== value));
      return;
    }

    setSelected([...selected, value]);
  };

  const runManagedAction = useCallback(
    async (
      label: string,
      action: () => Promise<void>,
      successTitle: string,
      successDescription: string,
      errorTitle: string,
    ) => {
      setWorkingLabel(label);
      setNotice(null);

      try {
        await action();
        setNotice({
          tone: "success",
          title: successTitle,
          description: successDescription,
        });
      } catch (error) {
        setNotice({
          tone: "error",
          title: errorTitle,
          description: getErrorMessage(error, "Please try again."),
        });
      } finally {
        setWorkingLabel(null);
      }
    },
    [],
  );

  const getOperationPodContext = (item: OperationItem) => {
    const app = item.appRef ? appByRef.get(item.appRef) : undefined;
    if (app) {
      return {
        pods: app.pods,
        podCount: app.podCount,
        readyPodCount: app.readyPodCount,
        workloadLabel: app.displayName,
      };
    }

    const backupSet = item.backupSetId ? backupSetById.get(item.backupSetId) : undefined;
    return {
      pods: backupSet?.pods ?? [],
      podCount: backupSet?.podCount ?? 0,
      readyPodCount: backupSet?.readyPodCount ?? 0,
      workloadLabel:
        getWorkloadLabel(
          backupSet?.namespace,
          backupSet?.workloadKind,
          backupSet?.workloadName,
        ) || backupSet?.displayName,
    };
  };

  const runBackup = async () => {
    if (selectedApps.length === 0) {
      return;
    }

    await runManagedAction(
      "backup",
      async () => {
        await sendJson("/api/operations", "POST", {
          type: "backup",
          appRefs: selectedApps,
          mode: backupMode,
        });
        setSelectedBackupSets([]);
        await refresh();
      },
      "Backup queued",
      `${pluralize(selectedApps.length, "workload")} added to the backup queue in ${backupMode} mode.`,
      "Could not queue the backup",
    );
  };

  const runRestore = async () => {
    if (selectedBackupSets.length === 0) {
      return;
    }

    await runManagedAction(
      "restore",
      async () => {
        await sendJson("/api/operations", "POST", {
          type: "restore",
          backupSetIds: selectedBackupSets,
          restoreMode,
          targetNamespace: restoreNamespace,
        });
        await refresh();
      },
      "Restore queued",
      `${pluralize(selectedBackupSets.length, "backup set")} added to the restore queue in ${restoreMode} mode.`,
      "Could not queue the restore",
    );
  };

  const saveTarget = async () => {
    await runManagedAction(
      "target",
      async () => {
        await sendJson("/api/targets", "PUT", {
          backupTargetURL: targetUrl,
          credentialSecret: targetSecret,
          pollInterval: targetPollInterval,
        });
        setTargetDirty(false);
        await refresh();
      },
      "Backup target saved",
      "Longhorn target settings were updated and will be re-validated on the next poll.",
      "Could not save the backup target",
    );
  };

  const createSchedule = async () => {
    if (selectedApps.length === 0 || !scheduleName.trim()) {
      return;
    }

    await runManagedAction(
      "schedule",
      async () => {
        await sendJson("/api/schedules", "POST", {
          name: scheduleName,
          cron: scheduleCron,
          appRefs: selectedApps,
        });
        setScheduleName("");
        await refresh();
      },
      "Schedule created",
      `${scheduleName.trim()} will protect ${pluralize(selectedApps.length, "selected workload")}.`,
      "Could not create the schedule",
    );
  };

  const setScheduleEnabled = async (schedule: ScheduleDefinition, enabled: boolean) => {
    await runManagedAction(
      `schedule:${schedule.id}`,
      async () => {
        await sendJson("/api/schedules", "PUT", {
          id: schedule.id,
          enabled,
        });
        await refresh();
      },
      enabled ? "Schedule enabled" : "Schedule paused",
      `${schedule.name} is now ${enabled ? "active" : "paused"}.`,
      `Could not ${enabled ? "enable" : "pause"} the schedule`,
    );
  };

  const deleteExistingSchedule = async (schedule: ScheduleDefinition) => {
    await runManagedAction(
      `schedule-delete:${schedule.id}`,
      async () => {
        await sendJson<{ ok: boolean }>("/api/schedules", "DELETE", {
          id: schedule.id,
        });
        await refresh();
      },
      "Schedule deleted",
      `${schedule.name} has been removed from the backup plan.`,
      "Could not delete the schedule",
    );
  };

  const targets = uiState.dashboard?.targets || [];
  const schedules = uiState.dashboard?.schedules || [];
  const overview = uiState.dashboard?.overview;
  const activeSchedules = schedules.filter((schedule) => schedule.enabled).length;
  const healthyTargetCount = targets.filter((target) => target.available).length;
  const cloneReadyBackupCount = uiState.backupSets.filter(
    (backupSet) => backupSet.cloneRestoreSupported,
  ).length;
  const selectedAppVolumeCount = selectedAppRecords.reduce(
    (sum, app) => sum + app.volumes.length,
    0,
  );
  const selectedBackupVolumeCount = selectedBackupSetRecords.reduce(
    (sum, backupSet) => sum + backupSet.volumeCount,
    0,
  );
  const selectedCloneReadyCount = selectedBackupSetRecords.filter(
    (backupSet) => backupSet.cloneRestoreSupported,
  ).length;
  const hasConsoleData =
    Boolean(overview) ||
    protectedApps.length > 0 ||
    uiState.backupSets.length > 0 ||
    uiState.operations.length > 0 ||
    targets.length > 0 ||
    schedules.length > 0;
  const bootstrapping = uiState.loading && !hasConsoleData;
  const fatalError = Boolean(uiState.error) && !hasConsoleData && !bootstrapping;
  const defaultTarget = targets.find((target) => target.name === "default") || targets[0];
  const targetStatusLabel =
    targets.length === 0
      ? "Not configured"
      : healthyTargetCount === targets.length
        ? "Healthy"
        : `${healthyTargetCount}/${targets.length} healthy`;

  return (
    <main className="min-h-screen px-4 py-5 text-sm text-slate-100 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <div className="mx-auto flex w-full max-w-[94rem] flex-col gap-6">
        <section className="panel panel-grid relative overflow-hidden rounded-[32px] p-6 sm:p-8">
          <div className="absolute -right-16 top-0 hidden h-64 w-64 rounded-full bg-sky-400/10 blur-3xl xl:block" />
          <div className="relative grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-xs font-medium tracking-wide text-sky-100">
                <ShieldCheck className="h-4 w-4" />
                Behind oauth2-proxy, powered by Longhorn
              </div>
              <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                Orbit Backup Console
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                Protect PVC-backed workloads, schedule recurring coverage, and restore safe
                clones with a calmer, clearer console built for day-two operations.
              </p>
              <div className="mt-6 flex flex-wrap gap-2 text-xs text-slate-200">
                <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5">
                  Auto-refresh every 5s
                </span>
                <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5">
                  {pluralize(overview?.protectedWorkloadCount ?? protectedApps.length, "protected workload")}
                </span>
                <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5">
                  {pluralize(cloneReadyBackupCount, "clone-ready backup set")}
                </span>
                <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5">
                  Target status: {targetStatusLabel}
                </span>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-slate-950/60 p-5 shadow-[0_20px_70px_rgba(2,6,23,0.35)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="section-label">Operator checklist</div>
                  <h2 className="mt-3 text-lg font-semibold text-white">Keep the daily flow obvious</h2>
                  <p className="mt-2 text-sm text-slate-400">
                    Configure storage, pick workloads, then use the restore catalog when you need
                    a fast recovery path.
                  </p>
                </div>
                {isRefreshing ? <LoaderCircle className="h-5 w-5 animate-spin text-sky-200" /> : null}
              </div>

              <div className="mt-5 space-y-3">
                {[
                  {
                    step: "01",
                    title: "Configure the backup target",
                    description:
                      defaultTarget?.backupTargetURL || "Point Longhorn at S3, Azure Blob, NFS, or SMB.",
                  },
                  {
                    step: "02",
                    title: "Pick workloads to protect",
                    description:
                      selectedApps.length > 0
                        ? `${pluralize(selectedApps.length, "workload")} selected across ${pluralize(selectedAppVolumeCount, "volume")}.`
                        : "Select PVC-backed apps to unlock backup and scheduling actions.",
                  },
                  {
                    step: "03",
                    title: "Restore with the right level of safety",
                    description:
                      selectedBackupSets.length > 0
                        ? `${pluralize(selectedBackupSets.length, "backup set")} selected for restore review.`
                        : "Use clone restore for safe workload copies or PVC-only mode for detached claims.",
                  },
                ].map((item) => (
                  <div
                    className="flex items-start gap-4 rounded-[24px] border border-white/8 bg-white/5 px-4 py-4"
                    key={item.step}
                  >
                    <div className="rounded-full border border-white/10 bg-slate-950/75 px-2.5 py-1 text-[11px] font-semibold tracking-[0.24em] text-slate-400">
                      {item.step}
                    </div>
                    <div>
                      <div className="font-medium text-white">{item.title}</div>
                      <div className="mt-1 text-sm text-slate-400">{item.description}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-4 py-2 font-medium text-slate-100 transition hover:border-sky-400/40 hover:bg-sky-400/10 disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={isRefreshing}
                  onClick={() => void refresh()}
                  type="button"
                >
                  <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                  {isRefreshing ? "Refreshing..." : "Refresh now"}
                </button>
                {uiState.dashboard?.user.email ? (
                  <div className="rounded-full border border-white/10 bg-slate-950/70 px-4 py-2 text-xs text-slate-300">
                    Signed in as {uiState.dashboard.user.email}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {notice ? (
          <div
            className={cn(
              "rounded-[24px] border px-4 py-3",
              notice.tone === "success"
                ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-50"
                : "border-rose-400/25 bg-rose-400/10 text-rose-50",
            )}
          >
            <div className="font-medium">{notice.title}</div>
            <div className="mt-1 text-sm opacity-90">{notice.description}</div>
          </div>
        ) : null}

        {uiState.error && hasConsoleData ? (
          <div className="rounded-[24px] border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-rose-50">
            <div className="font-medium">Live refresh needs attention</div>
            <div className="mt-1 text-sm opacity-90">{uiState.error}</div>
          </div>
        ) : null}

        {bootstrapping ? (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <SkeletonPanel className="rounded-[28px] p-5" key={index} />
              ))}
            </section>
            <section className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
              <div className="space-y-6">
                <SkeletonPanel />
                <SkeletonPanel />
              </div>
              <div className="space-y-6">
                <SkeletonPanel />
                <SkeletonPanel />
              </div>
            </section>
            <SkeletonPanel />
          </>
        ) : fatalError ? (
          <section className="panel rounded-[32px] p-6 sm:p-8">
            <EmptyState
              action={
                <button
                  className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-4 py-2 font-medium text-slate-950 transition hover:bg-sky-400"
                  onClick={() => void refresh()}
                  type="button"
                >
                  <RefreshCw className="h-4 w-4" />
                  Retry loading
                </button>
              }
              description={uiState.error || "The console could not reach the cluster right now."}
              title="The backup console could not load cluster state"
            />
          </section>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  label: "Protected workloads",
                  value: overview?.protectedWorkloadCount ?? protectedApps.length,
                  detail: selectedApps.length
                    ? `${pluralize(selectedApps.length, "selected workload")}`
                    : "Ready for selection",
                  icon: DatabaseBackup,
                  tone: "from-sky-400/20 via-sky-400/5 to-transparent",
                },
                {
                  label: "Backup catalog",
                  value: overview?.backupSetCount ?? uiState.backupSets.length,
                  detail: `${pluralize(cloneReadyBackupCount, "clone-ready set")}`,
                  icon: Cloud,
                  tone: "from-violet-400/20 via-violet-400/5 to-transparent",
                },
                {
                  label: "Live activity",
                  value: overview?.runningOperations ?? 0,
                  detail: `${pluralize(uiState.operations.length, "recent operation")}`,
                  icon: LoaderCircle,
                  tone: "from-amber-400/20 via-amber-400/5 to-transparent",
                },
                {
                  label: "Schedules active",
                  value: activeSchedules,
                  detail: `${pluralize(schedules.length, "saved schedule")}`,
                  icon: Workflow,
                  tone: "from-emerald-400/20 via-emerald-400/5 to-transparent",
                },
              ].map(({ label, value, detail, icon: Icon, tone }) => (
                <div
                  className={`panel rounded-[28px] bg-gradient-to-br ${tone} p-5`}
                  key={label}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="section-label">{label}</div>
                      <div className="mt-4 text-3xl font-semibold tracking-tight text-white">{value}</div>
                      <div className="mt-2 text-sm text-slate-400">{detail}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/6 p-3">
                      <Icon className="h-5 w-5 text-slate-200" />
                    </div>
                  </div>
                </div>
              ))}
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
              <div className="space-y-6">
                <section className="panel rounded-[32px] p-5 sm:p-6">
                  <SectionHeading
                    description="Select PVC-backed apps, choose the backup depth, and queue protection without dropping into PVC-by-PVC workflows."
                    eyebrow="Backup flow"
                    title="Protect workloads"
                  />

                  <div className="mt-5 rounded-[28px] border border-white/8 bg-slate-950/55 p-4 sm:p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="section-label">Step 1</div>
                        <div className="mt-3 text-lg font-medium text-white">
                          Choose workload coverage and queue a backup
                        </div>
                        <p className="mt-2 max-w-2xl text-sm text-slate-400">
                          Orbit only lists workloads with protected storage so the backup path stays
                          focused and shippable.
                        </p>
                      </div>

                      <div className="flex flex-col gap-3 sm:items-end">
                        <div className="flex flex-wrap gap-2">
                          {[
                            {
                              id: "incremental",
                              label: "Incremental",
                              description: "Fastest routine protection",
                            },
                            {
                              id: "full",
                              label: "Full",
                              description: "Fresh full backup chain",
                            },
                          ].map((mode) => (
                            <button
                              className={cn(
                                "rounded-full border px-3.5 py-2 text-left text-xs transition",
                                backupMode === mode.id
                                  ? "border-sky-400/30 bg-sky-400/12 text-sky-50"
                                  : "border-white/10 bg-white/5 text-slate-300 hover:border-sky-400/20 hover:text-white",
                              )}
                              key={mode.id}
                              onClick={() => setBackupMode(mode.id as BackupMode)}
                              type="button"
                            >
                              <div className="font-medium">{mode.label}</div>
                              <div className="text-[11px] opacity-80">{mode.description}</div>
                            </button>
                          ))}
                        </div>
                        <button
                          className="inline-flex items-center justify-center gap-2 rounded-full bg-sky-500 px-4 py-2.5 font-medium text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                          disabled={selectedApps.length === 0 || workingLabel === "backup"}
                          onClick={() => void runBackup()}
                          type="button"
                        >
                          <ArrowUpFromLine className="h-4 w-4" />
                          {workingLabel === "backup"
                            ? "Queueing backup..."
                            : `Back up ${selectedApps.length ? pluralize(selectedApps.length, "app") : "selected apps"}`}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[24px] border border-sky-400/20 bg-sky-400/10 px-4 py-4">
                    {selectedApps.length > 0 ? (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="font-medium text-sky-50">
                            {pluralize(selectedApps.length, "workload")} selected for protection
                          </div>
                          <div className="mt-1 text-sm text-sky-100/80">
                            Covers {pluralize(selectedAppVolumeCount, "Longhorn volume")} and can
                            be reused when you create a schedule.
                          </div>
                        </div>
                        <div className="text-xs uppercase tracking-[0.24em] text-sky-100/70">
                          Backup and schedule ready
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="font-medium text-sky-50">No workloads selected yet</div>
                        <div className="mt-1 text-sm text-sky-100/80">
                          Pick one or more PVC-backed apps below to enable backup and schedule
                          actions.
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-5">
                    {protectedApps.length > 0 ? (
                      <div className="grid gap-4 xl:grid-cols-2">
                        {protectedApps.map((app) => (
                          <AppSelectionCard
                            app={app}
                            key={app.ref}
                            onToggle={() =>
                              toggleSelection(selectedApps, setSelectedApps, app.ref)
                            }
                            selected={selectedApps.includes(app.ref)}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        description="Orbit did not find any PVC-backed workloads to protect yet. Once protected apps appear, they will be listed here with pod health and storage details."
                        title="No protected workloads detected"
                      />
                    )}
                  </div>
                </section>

                <section className="panel rounded-[32px] p-5 sm:p-6">
                  <SectionHeading
                    description="Review backup sets, choose the safest restore path, and send only the work that matches the selected recovery mode."
                    eyebrow="Restore flow"
                    title="Restore from the backup catalog"
                  />

                  <div className="mt-5 rounded-[28px] border border-white/8 bg-slate-950/55 p-4 sm:p-5">
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                      <div className="space-y-4">
                        <div>
                          <div className="section-label">Step 2</div>
                          <div className="mt-3 text-lg font-medium text-white">
                            Choose the restore shape before you queue work
                          </div>
                          <p className="mt-2 max-w-2xl text-sm text-slate-400">
                            Clone restore keeps workload wiring intact for supported backups. PVC-only
                            restore recreates detached claims when you only need the storage.
                          </p>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2">
                          {[
                            {
                              id: "clone-workload",
                              label: "Clone workload",
                              description: "Rebuild the workload in a safe namespace",
                            },
                            {
                              id: "pvc-only",
                              label: "PVC-only restore",
                              description: "Create detached claims without the controller",
                            },
                          ].map((mode) => (
                            <button
                              className={cn(
                                "rounded-[22px] border px-4 py-3 text-left transition",
                                restoreMode === mode.id
                                  ? "border-violet-400/30 bg-violet-400/12 text-violet-50"
                                  : "border-white/10 bg-white/5 text-slate-300 hover:border-violet-400/20 hover:text-white",
                              )}
                              key={mode.id}
                              onClick={() => setRestoreMode(mode.id as RestoreMode)}
                              type="button"
                            >
                              <div className="font-medium">{mode.label}</div>
                              <div className="mt-1 text-xs opacity-80">{mode.description}</div>
                            </button>
                          ))}
                        </div>

                        <label className="block">
                          <span className="field-label">Target namespace</span>
                          <input
                            className="mt-2 w-full rounded-[20px] border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-violet-400/40 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={restoreMode !== "clone-workload"}
                            onChange={(event) => setRestoreNamespace(event.target.value)}
                            placeholder={defaultCloneNamespace}
                            value={restoreNamespace}
                          />
                          <div className="mt-2 text-xs text-slate-500">
                            {restoreMode === "clone-workload"
                              ? "Orbit suggests a safe clone namespace based on the selected backup set."
                              : "Namespace is only used for clone restore. PVC-only mode ignores this field."}
                          </div>
                        </label>
                      </div>

                      <button
                        className="inline-flex items-center justify-center gap-2 rounded-full bg-violet-400 px-4 py-2.5 font-medium text-slate-950 transition hover:bg-violet-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                        disabled={restoreDisabled}
                        onClick={() => void runRestore()}
                        type="button"
                      >
                        <ArrowDownToLine className="h-4 w-4" />
                        {workingLabel === "restore"
                          ? "Queueing restore..."
                          : `Restore ${selectedBackupSets.length ? pluralize(selectedBackupSets.length, "set") : "selected sets"}`}
                      </button>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "mt-4 rounded-[24px] border px-4 py-4 text-sm",
                      cloneRestoreSelectionError
                        ? "border-amber-400/25 bg-amber-400/10 text-amber-50"
                        : "border-white/8 bg-slate-950/55 text-slate-300",
                    )}
                  >
                    {restoreMode === "clone-workload"
                      ? cloneRestoreSelectionError ||
                        "Clone restore keeps supported Deployment and StatefulSet backups close to their original workload shape so validation stays safer and faster."
                      : "PVC-only restore recreates detached Longhorn-backed claims without rehydrating the workload controller."}
                  </div>

                  <div className="mt-4 rounded-[24px] border border-violet-400/18 bg-violet-400/10 px-4 py-4">
                    {selectedBackupSets.length > 0 ? (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="font-medium text-violet-50">
                            {pluralize(selectedBackupSets.length, "backup set")} selected for restore
                          </div>
                          <div className="mt-1 text-sm text-violet-100/80">
                            Covers {pluralize(selectedBackupVolumeCount, "volume")} with {pluralize(
                              selectedCloneReadyCount,
                              "clone-ready set",
                            )}.
                          </div>
                        </div>
                        <div className="text-xs uppercase tracking-[0.24em] text-violet-100/70">
                          Review compatibility before queueing
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="font-medium text-violet-50">No backup sets selected yet</div>
                        <div className="mt-1 text-sm text-violet-100/80">
                          Select one or more backups below to unlock restore controls and clone-mode
                          validation.
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-5">
                    {uiState.backupSets.length > 0 ? (
                      <div className="space-y-4">
                        {uiState.backupSets.map((backupSet) => (
                          <BackupSetCard
                            backupSet={backupSet}
                            key={backupSet.id}
                            onToggle={() =>
                              toggleSelection(
                                selectedBackupSets,
                                setSelectedBackupSets,
                                backupSet.id,
                              )
                            }
                            selected={selectedBackupSets.includes(backupSet.id)}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        description="Once backups are captured, Orbit will list them here with restore compatibility, captured volumes, and current pod context."
                        title="No backup sets available yet"
                      />
                    )}
                  </div>
                </section>
              </div>

              <aside className="space-y-6">
                <section className="panel rounded-[32px] p-5 sm:p-6">
                  <SectionHeading
                    actions={
                      <span
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-medium",
                          healthyTargetCount > 0
                            ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                            : "border-slate-400/20 bg-slate-400/10 text-slate-200",
                        )}
                      >
                        {targetStatusLabel}
                      </span>
                    }
                    description="Point Longhorn at your object store or share, then keep the polling cadence explicit so operators know how quickly target health updates."
                    eyebrow="Storage target"
                    title="Configure backup storage"
                  />

                  <div className="mt-5 rounded-[28px] border border-white/8 bg-slate-950/55 p-4 sm:p-5">
                    <div className="space-y-4">
                      <label className="block">
                        <span className="field-label">Target URL</span>
                        <input
                          className="mt-2 w-full rounded-[20px] border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-sky-400/40"
                          onChange={(event) => {
                            setTargetDirty(true);
                            setTargetUrl(event.target.value);
                          }}
                          placeholder="azblob://backup-container@core.windows.net/"
                          value={targetUrl}
                        />
                      </label>

                      <label className="block">
                        <span className="field-label">Credential secret</span>
                        <input
                          className="mt-2 w-full rounded-[20px] border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-sky-400/40"
                          onChange={(event) => {
                            setTargetDirty(true);
                            setTargetSecret(event.target.value);
                          }}
                          placeholder="azure-backup-credentials"
                          value={targetSecret}
                        />
                      </label>

                      <label className="block">
                        <span className="field-label">Poll interval</span>
                        <input
                          className="mt-2 w-full rounded-[20px] border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-sky-400/40"
                          onChange={(event) => {
                            setTargetDirty(true);
                            setTargetPollInterval(event.target.value);
                          }}
                          placeholder="300s"
                          value={targetPollInterval}
                        />
                      </label>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-white/8 bg-white/5 px-4 py-3 text-xs text-slate-400">
                      <span>
                        Changes sync to Longhorn and will surface in the live status cards on the
                        next refresh cycle.
                      </span>
                      {targetDirty ? (
                        <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-amber-100">
                          Unsaved changes
                        </span>
                      ) : null}
                    </div>

                    <button
                      className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-400 px-4 py-2.5 font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                      disabled={!targetUrl || workingLabel === "target"}
                      onClick={() => void saveTarget()}
                      type="button"
                    >
                      <Cloud className="h-4 w-4" />
                      {workingLabel === "target" ? "Saving target..." : "Save target"}
                    </button>
                  </div>

                  <div className="mt-5 space-y-3">
                    {targets.length > 0 ? (
                      targets.map((target) => (
                        <div
                          className="rounded-[24px] border border-white/8 bg-slate-950/60 px-4 py-4"
                          key={target.name}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium text-white">{target.name}</div>
                              <div className="mt-1 break-all text-xs text-slate-500">
                                {target.backupTargetURL || "No target URL configured"}
                              </div>
                            </div>
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(
                                target.available ? "Completed" : "failed",
                              )}`}
                            >
                              {target.available ? "Available" : "Unavailable"}
                            </span>
                          </div>
                          <div className="mt-3 text-xs text-slate-400">
                            Last synced {formatTimestamp(target.lastSyncedAt)}
                          </div>
                          {target.conditions.length > 0 ? (
                            <div className="mt-3 space-y-2 text-xs text-rose-100">
                              {target.conditions.map((condition) => (
                                <div
                                  className="rounded-2xl border border-rose-400/15 bg-rose-400/10 px-3 py-2"
                                  key={condition}
                                >
                                  {condition}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <EmptyState
                        description="Save a target to start writing backups to object storage or a supported share."
                        title="No backup targets configured"
                      />
                    )}
                  </div>
                </section>

                <section className="panel rounded-[32px] p-5 sm:p-6">
                  <SectionHeading
                    actions={
                      <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-xs font-medium text-violet-100">
                        {pluralize(activeSchedules, "active schedule")}
                      </span>
                    }
                    description="Schedules reuse the workload selection from the backup flow so operators can promote the exact set they just reviewed into recurring protection."
                    eyebrow="Recurring protection"
                    title="Manage schedules"
                  />

                  <div className="mt-5 rounded-[28px] border border-white/8 bg-slate-950/55 p-4 sm:p-5">
                    <div className="rounded-[24px] border border-violet-400/18 bg-violet-400/10 px-4 py-4">
                      {selectedApps.length > 0 ? (
                        <div>
                          <div className="font-medium text-violet-50">
                            New schedule will cover {pluralize(selectedApps.length, "selected workload")}
                          </div>
                          <div className="mt-1 text-sm text-violet-100/80">
                            Current selection includes {pluralize(selectedAppVolumeCount, "volume")}.
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="font-medium text-violet-50">Select workloads first</div>
                          <div className="mt-1 text-sm text-violet-100/80">
                            Use the backup flow to choose which apps this schedule should protect.
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 space-y-4">
                      <label className="block">
                        <span className="field-label">Schedule name</span>
                        <input
                          className="mt-2 w-full rounded-[20px] border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-violet-400/40"
                          onChange={(event) => setScheduleName(event.target.value)}
                          placeholder="Nightly protected apps"
                          value={scheduleName}
                        />
                      </label>

                      <label className="block">
                        <span className="field-label">Cron expression</span>
                        <input
                          className="mt-2 w-full rounded-[20px] border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-violet-400/40"
                          onChange={(event) => setScheduleCron(event.target.value)}
                          placeholder="0 3 * * *"
                          value={scheduleCron}
                        />
                      </label>
                    </div>

                    <button
                      className="mt-4 inline-flex items-center gap-2 rounded-full bg-violet-400 px-4 py-2.5 font-medium text-slate-950 transition hover:bg-violet-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                      disabled={
                        selectedApps.length === 0 ||
                        !scheduleName.trim() ||
                        workingLabel === "schedule"
                      }
                      onClick={() => void createSchedule()}
                      type="button"
                    >
                      <Workflow className="h-4 w-4" />
                      {workingLabel === "schedule" ? "Saving schedule..." : "Create schedule"}
                    </button>
                  </div>

                  <div className="mt-5 space-y-3">
                    {schedules.length > 0 ? (
                      schedules.map((schedule) => (
                        <div
                          className="rounded-[24px] border border-white/8 bg-slate-950/60 px-4 py-4"
                          key={schedule.id}
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="font-medium text-white">{schedule.name}</div>
                                <span
                                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(
                                    schedule.enabled ? "Completed" : "stopped",
                                  )}`}
                                >
                                  {schedule.enabled ? "Enabled" : "Paused"}
                                </span>
                                {schedule.backend ? (
                                  <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-2.5 py-1 text-xs font-medium text-violet-100">
                                    Longhorn native
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-2 text-xs text-slate-400">
                                {schedule.cron} · {pluralize(schedule.appRefs.length, "workload")}
                                {typeof schedule.activeVolumeCount === "number"
                                  ? ` · ${pluralize(schedule.activeVolumeCount, "volume")}`
                                  : ""}
                              </div>
                              {schedule.appDisplayNames?.length ? (
                                <div className="mt-2 text-xs text-slate-500">
                                  {schedule.appDisplayNames.slice(0, 3).join(", ")}
                                  {schedule.appDisplayNames.length > 3
                                    ? ` +${schedule.appDisplayNames.length - 3} more`
                                    : ""}
                                </div>
                              ) : null}
                              <div className="mt-2 text-xs text-slate-400">
                                Next run {formatTimestamp(schedule.nextRunAt)}
                                {schedule.lastRunAt
                                  ? ` · Last run ${formatTimestamp(schedule.lastRunAt)}`
                                  : ""}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-violet-400/25 hover:text-white"
                                onClick={() =>
                                  void setScheduleEnabled(schedule, !schedule.enabled)
                                }
                                type="button"
                              >
                                {workingLabel === `schedule:${schedule.id}`
                                  ? "Saving..."
                                  : schedule.enabled
                                    ? "Pause"
                                    : "Enable"}
                              </button>
                              <button
                                className="rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1.5 text-xs font-medium text-rose-100 transition hover:bg-rose-400/20"
                                onClick={() => void deleteExistingSchedule(schedule)}
                                type="button"
                              >
                                {workingLabel === `schedule-delete:${schedule.id}`
                                  ? "Deleting..."
                                  : "Delete"}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <EmptyState
                        description="Recurring jobs will appear here once you save the first schedule."
                        title="No schedules yet"
                      />
                    )}
                  </div>
                </section>
              </aside>
            </section>

            <section className="panel rounded-[32px] p-5 sm:p-6">
              <SectionHeading
                actions={
                  <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-xs font-medium text-sky-100">
                    Live queue · {pluralize(overview?.runningOperations ?? 0, "active run")}
                  </span>
                }
                description="Operations poll live so you can see queued, active, and finished work without leaving the console. Expand an item for per-volume progress and timeline details."
                eyebrow="Operations"
                title="Runs and progress"
              />

              <div className="mt-5">
                {uiState.operations.length > 0 ? (
                  <div className="space-y-4">
                    {uiState.operations.map((operation) => {
                      const completedItems = operation.items.filter(
                        (item) => item.status === "succeeded" || item.status === "skipped",
                      ).length;
                      const progress = averageProgress(operation.items);

                      return (
                        <article
                          className={cn(
                            "rounded-[28px] border p-5",
                            operation.status === "running"
                              ? "border-sky-400/20 bg-sky-400/8"
                              : "border-white/8 bg-slate-950/60",
                          )}
                          key={operation.id}
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium uppercase tracking-[0.2em] text-slate-300">
                                  {operation.type}
                                </span>
                                <span
                                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(
                                    operation.status,
                                  )}`}
                                >
                                  {operation.status}
                                </span>
                                {operation.mode ? (
                                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300">
                                    {operation.mode}
                                  </span>
                                ) : null}
                              </div>
                              <h3 className="mt-3 text-lg font-semibold text-white">
                                {operation.summary}
                              </h3>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                                <span>Requested by {operation.requestedBy}</span>
                                <span>•</span>
                                <span>Created {formatTimestamp(operation.createdAt)}</span>
                                {operation.finishedAt ? (
                                  <>
                                    <span>•</span>
                                    <span>Finished {formatTimestamp(operation.finishedAt)}</span>
                                  </>
                                ) : null}
                              </div>
                            </div>

                            <div className="rounded-[24px] border border-white/8 bg-slate-950/65 px-4 py-4 text-sm sm:min-w-[14rem]">
                              <div className="flex items-center justify-between text-slate-400">
                                <span>Items</span>
                                <span className="font-medium text-slate-200">{operation.items.length}</span>
                              </div>
                              <div className="mt-2 flex items-center justify-between text-slate-400">
                                <span>Completed</span>
                                <span className="font-medium text-slate-200">
                                  {completedItems}/{operation.items.length}
                                </span>
                              </div>
                              <div className="mt-2 flex items-center justify-between text-slate-400">
                                <span>Average progress</span>
                                <span className="font-medium text-slate-200">{progress}%</span>
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-900/90">
                            <div
                              className="h-full rounded-full bg-sky-400 transition-all"
                              style={{ width: `${Math.max(progress, operation.status === "queued" ? 8 : 0)}%` }}
                            />
                          </div>

                          <div className="mt-4 space-y-3">
                            {operation.items.map((item) => {
                              const podContext = getOperationPodContext(item);

                              return (
                                <details
                                  className="rounded-[24px] border border-white/8 bg-slate-950/70 px-4 py-4"
                                  key={item.id}
                                >
                                  <summary className="cursor-pointer list-none">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                      <div>
                                        <div className="font-medium text-white">{item.displayName}</div>
                                        <div className="mt-1 text-sm text-slate-400">
                                          {item.message || "Waiting for the next step..."}
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span
                                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(
                                            item.status,
                                          )}`}
                                        >
                                          {item.status}
                                        </span>
                                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300">
                                          {item.progress}%
                                        </span>
                                      </div>
                                    </div>
                                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-900/90">
                                      <div
                                        className="h-full rounded-full bg-sky-400 transition-all"
                                        style={{ width: `${Math.max(item.progress, 4)}%` }}
                                      />
                                    </div>
                                  </summary>

                                  <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                                    {(item.appRef || item.backupSetId) && (
                                      <WorkloadPodPanel
                                        emptyMessage="No current cluster pods are mapped to this workload."
                                        podCount={podContext.podCount}
                                        pods={podContext.pods}
                                        readyPodCount={podContext.readyPodCount}
                                        workloadLabel={podContext.workloadLabel}
                                      />
                                    )}

                                    <div className="space-y-3">
                                      {item.volumes.map((volume, index) => (
                                        <div
                                          className="rounded-[20px] border border-white/8 bg-white/5 px-4 py-4 text-xs text-slate-300"
                                          key={`${item.id}-${index}`}
                                        >
                                          <div className="flex flex-wrap items-center justify-between gap-3">
                                            <div className="font-medium text-white">
                                              {volume.pvcName || volume.volumeName || "Volume"}
                                            </div>
                                            <span
                                              className={`inline-flex rounded-full border px-2.5 py-1 font-medium ${badgeClass(
                                                volume.status,
                                              )}`}
                                            >
                                              {volume.status}
                                            </span>
                                          </div>
                                          {volume.message ? (
                                            <div className="mt-2 text-rose-100">{volume.message}</div>
                                          ) : null}
                                          {(volume.backupName ||
                                            volume.snapshotName ||
                                            volume.restoredClaimName) && (
                                            <div className="mt-3 space-y-1 text-slate-400">
                                              {volume.snapshotName ? (
                                                <div>Snapshot: {volume.snapshotName}</div>
                                              ) : null}
                                              {volume.backupName ? (
                                                <div>Backup: {volume.backupName}</div>
                                              ) : null}
                                              {volume.restoredClaimName ? (
                                                <div>
                                                  Restored PVC: {volume.restoredNamespace}/
                                                  {volume.restoredClaimName}
                                                </div>
                                              ) : null}
                                            </div>
                                          )}
                                        </div>
                                      ))}

                                      {item.logs.length > 0 ? (
                                        <div className="rounded-[20px] border border-white/8 bg-white/5 px-4 py-4">
                                          <div className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">
                                            Timeline
                                          </div>
                                          <div className="mt-3 space-y-2">
                                            {item.logs.slice(0, 8).map((log) => (
                                              <div
                                                className="flex gap-3 text-xs"
                                                key={`${item.id}-${log.timestamp}-${log.message}`}
                                              >
                                                <span className="w-32 shrink-0 text-slate-500">
                                                  {formatTimestamp(log.timestamp)}
                                                </span>
                                                <span
                                                  className={
                                                    log.level === "error"
                                                      ? "text-rose-100"
                                                      : "text-slate-300"
                                                  }
                                                >
                                                  {log.message}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                </details>
                              );
                            })}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    description="Queued, running, and completed backup work will appear here with per-item progress once the first operation is created."
                    title="No backup activity yet"
                  />
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
