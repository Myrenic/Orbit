"use client";

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

function formatTimestamp(value?: string) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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
      return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
    case "running":
    case "queued":
    case "InProgress":
      return "border-sky-400/25 bg-sky-400/10 text-sky-200";
    case "stopped":
      return "border-slate-400/25 bg-slate-400/10 text-slate-200";
    default:
      return "border-rose-400/25 bg-rose-400/10 text-rose-200";
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

type WorkloadPodPanelProps = {
  pods: PodSummary[];
  podCount: number;
  readyPodCount: number;
  emptyMessage: string;
  workloadLabel?: string;
};

function WorkloadPodPanel({
  pods,
  podCount,
  readyPodCount,
  emptyMessage,
  workloadLabel,
}: WorkloadPodPanelProps) {
  const effectivePodCount = Math.max(podCount, pods.length);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 px-3 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Workload pods
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
        <div className="mt-3 flex flex-wrap gap-2">
          {pods.map((pod) => {
            const tone = getPodTone(pod);
            return (
              <span
                className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-xs ${tone.badge}`}
                key={pod.name}
              >
                <span className={`status-dot shrink-0 ${tone.dot}`} />
                <span className="max-w-[10rem] truncate font-medium sm:max-w-[14rem]">
                  {pod.name}
                </span>
                <span className="text-slate-300">{tone.label}</span>
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
        <div className="mt-3 text-xs text-slate-400">{emptyMessage}</div>
      )}
    </div>
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
  const [workingLabel, setWorkingLabel] = useState<string | null>(null);

  const refresh = useCallback(async () => {
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
      if (defaultTarget) {
        setTargetUrl(defaultTarget.backupTargetURL || "");
        setTargetSecret(defaultTarget.credentialSecret || "");
        setTargetPollInterval(defaultTarget.pollInterval || "300s");
      }
    } catch (error) {
      setUiState((previous) => ({
        ...previous,
        error: error instanceof Error ? error.message : "Failed to load the console.",
        loading: false,
      }));
    }
  }, []);

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

    setWorkingLabel("backup");
    try {
      await sendJson("/api/operations", "POST", {
        type: "backup",
        appRefs: selectedApps,
        mode: backupMode,
      });
      setSelectedBackupSets([]);
      await refresh();
    } finally {
      setWorkingLabel(null);
    }
  };

  const runRestore = async () => {
    if (selectedBackupSets.length === 0) {
      return;
    }

    setWorkingLabel("restore");
    try {
      await sendJson("/api/operations", "POST", {
        type: "restore",
        backupSetIds: selectedBackupSets,
        restoreMode,
        targetNamespace: restoreNamespace,
      });
      await refresh();
    } finally {
      setWorkingLabel(null);
    }
  };

  const saveTarget = async () => {
    setWorkingLabel("target");
    try {
      await sendJson("/api/targets", "PUT", {
        backupTargetURL: targetUrl,
        credentialSecret: targetSecret,
        pollInterval: targetPollInterval,
      });
      await refresh();
    } finally {
      setWorkingLabel(null);
    }
  };

  const createSchedule = async () => {
    if (selectedApps.length === 0 || !scheduleName.trim()) {
      return;
    }

    setWorkingLabel("schedule");
    try {
      await sendJson("/api/schedules", "POST", {
        name: scheduleName,
        cron: scheduleCron,
        appRefs: selectedApps,
      });
      setScheduleName("");
      await refresh();
    } finally {
      setWorkingLabel(null);
    }
  };

  const setScheduleEnabled = async (schedule: ScheduleDefinition, enabled: boolean) => {
    setWorkingLabel(`schedule:${schedule.id}`);
    try {
      await sendJson("/api/schedules", "PUT", {
        id: schedule.id,
        enabled,
      });
      await refresh();
    } finally {
      setWorkingLabel(null);
    }
  };

  const deleteExistingSchedule = async (schedule: ScheduleDefinition) => {
    setWorkingLabel(`schedule-delete:${schedule.id}`);
    try {
      await fetch("/api/schedules", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: schedule.id }),
      });
      await refresh();
    } finally {
      setWorkingLabel(null);
    }
  };

  const targets = uiState.dashboard?.targets || [];
  const schedules = uiState.dashboard?.schedules || [];
  const overview = uiState.dashboard?.overview;

  return (
    <main className="min-h-screen px-4 py-6 text-sm text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="panel rounded-3xl p-6 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-xs font-medium tracking-wide text-sky-200">
                <ShieldCheck className="h-4 w-4" />
                Behind oauth2-proxy, powered by Longhorn
              </div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Orbit Backup Console
              </h1>
              <p className="mt-3 max-w-2xl text-base text-slate-300">
                Backup and restore workloads by app instead of PVC name hunting. Batch
                work, restore clones safely, and watch Longhorn progress live from one
                place.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/50 px-4 py-2 font-medium text-slate-200 transition hover:border-sky-400/40 hover:text-white"
                onClick={() => void refresh()}
                type="button"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
              {uiState.dashboard?.user.email ? (
                <div className="rounded-full border border-slate-700 px-4 py-2 text-slate-300">
                  {uiState.dashboard.user.email}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {uiState.error ? (
          <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-rose-100">
            {uiState.error}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Cluster workloads",
              value: overview?.workloadCount ?? 0,
              icon: Workflow,
              tone: "from-sky-400/20 to-sky-400/0",
            },
            {
              label: "PVC-backed apps",
              value: overview?.protectedWorkloadCount ?? 0,
              icon: DatabaseBackup,
              tone: "from-emerald-400/20 to-emerald-400/0",
            },
            {
              label: "Backup sets",
              value: overview?.backupSetCount ?? 0,
              icon: Cloud,
              tone: "from-violet-400/20 to-violet-400/0",
            },
            {
              label: "Queued or running",
              value: overview?.runningOperations ?? 0,
              icon: LoaderCircle,
              tone: "from-amber-400/20 to-amber-400/0",
            },
          ].map(({ label, value, icon: Icon, tone }) => (
            <div
              className={`panel rounded-3xl bg-gradient-to-br ${tone} p-5`}
              key={label}
            >
              <div className="flex items-center justify-between">
                <span className="muted text-xs uppercase tracking-[0.24em]">{label}</span>
                <Icon className="h-5 w-5 text-slate-300" />
              </div>
              <div className="mt-4 text-3xl font-semibold">{value}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
          <div className="panel rounded-3xl p-5 sm:p-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Workload inventory</h2>
                <p className="mt-1 text-slate-400">
                  Select one or more PVC-backed apps and trigger a Longhorn-native backup.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100"
                  onChange={(event) => setBackupMode(event.target.value as BackupMode)}
                  value={backupMode}
                >
                  <option value="incremental">Incremental backup</option>
                  <option value="full">Full backup</option>
                </select>
                <button
                  className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-4 py-2 font-medium text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                  disabled={selectedApps.length === 0 || workingLabel === "backup"}
                  onClick={() => void runBackup()}
                  type="button"
                >
                  <ArrowUpFromLine className="h-4 w-4" />
                  {workingLabel === "backup" ? "Queueing..." : `Back up ${selectedApps.length || ""}`.trim()}
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {protectedApps.map((app) => (
                <label
                  className="cursor-pointer rounded-3xl border border-slate-800 bg-slate-950/40 p-4 transition hover:border-sky-400/30 hover:bg-slate-950/60"
                  key={app.ref}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          checked={selectedApps.includes(app.ref)}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-sky-400"
                          onChange={() =>
                            toggleSelection(selectedApps, setSelectedApps, app.ref)
                          }
                          type="checkbox"
                        />
                        <span className="text-base font-medium">{app.displayName}</span>
                      </div>
                      <div className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium uppercase tracking-wide text-slate-200">
                        <span className={`status-dot ${statusClass(app.status)}`} />
                        {app.status}
                      </div>
                    </div>
                    <div className="text-right text-slate-400">
                      <div>{app.volumes.length} volume{app.volumes.length === 1 ? "" : "s"}</div>
                      <div>{app.readyPodCount}/{app.podCount} pods ready</div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {app.volumes.map((volume) => (
                      <span
                        className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs text-slate-300"
                        key={volume.longhornVolumeName}
                      >
                        {volume.pvcName} {"->"} {volume.longhornVolumeName}
                      </span>
                    ))}
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="panel rounded-3xl p-5 sm:p-6">
              <h2 className="text-xl font-semibold">Backup target</h2>
              <p className="mt-1 text-slate-400">
                Point Longhorn at Azure Blob, S3-compatible storage, NFS, or SMB.
              </p>
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-wide text-slate-400">
                    Target URL
                  </span>
                  <input
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-slate-100 outline-none transition focus:border-sky-400"
                    onChange={(event) => setTargetUrl(event.target.value)}
                    placeholder="azblob://backup-container@core.windows.net/"
                    value={targetUrl}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-wide text-slate-400">
                    Credential secret
                  </span>
                  <input
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-slate-100 outline-none transition focus:border-sky-400"
                    onChange={(event) => setTargetSecret(event.target.value)}
                    placeholder="azure-backup-credentials"
                    value={targetSecret}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-wide text-slate-400">
                    Poll interval
                  </span>
                  <input
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-slate-100 outline-none transition focus:border-sky-400"
                    onChange={(event) => setTargetPollInterval(event.target.value)}
                    placeholder="300s"
                    value={targetPollInterval}
                  />
                </label>
              </div>

              <div className="mt-4 space-y-2">
                {targets.map((target) => (
                  <div
                    className="rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-3"
                    key={target.name}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{target.name}</span>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs ${badgeClass(
                          target.available ? "Completed" : "failed",
                        )}`}
                      >
                        {target.available ? "Available" : "Unavailable"}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-slate-400">
                      Last synced: {formatTimestamp(target.lastSyncedAt)}
                    </div>
                    {target.conditions.length > 0 ? (
                      <div className="mt-2 space-y-1 text-xs text-rose-200">
                        {target.conditions.map((condition) => (
                          <div key={condition}>{condition}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              <button
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-400 px-4 py-2 font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                disabled={!targetUrl || workingLabel === "target"}
                onClick={() => void saveTarget()}
                type="button"
              >
                <Cloud className="h-4 w-4" />
                {workingLabel === "target" ? "Saving..." : "Save target"}
              </button>
            </div>

            <div className="panel rounded-3xl p-5 sm:p-6">
              <h2 className="text-xl font-semibold">Schedules</h2>
              <p className="mt-1 text-slate-400">
                Keep selecting workloads here; Orbit now reflects each schedule into a
                Longhorn RecurringJob behind the scenes.
              </p>

              <div className="mt-4 space-y-3">
                <input
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-slate-100 outline-none transition focus:border-sky-400"
                  onChange={(event) => setScheduleName(event.target.value)}
                  placeholder="Nightly protected apps"
                  value={scheduleName}
                />
                <input
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-slate-100 outline-none transition focus:border-sky-400"
                  onChange={(event) => setScheduleCron(event.target.value)}
                  placeholder="0 3 * * *"
                  value={scheduleCron}
                />
              </div>

              <button
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-violet-400 px-4 py-2 font-medium text-slate-950 transition hover:bg-violet-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                disabled={
                  selectedApps.length === 0 ||
                  !scheduleName.trim() ||
                  workingLabel === "schedule"
                }
                onClick={() => void createSchedule()}
                type="button"
              >
                <Workflow className="h-4 w-4" />
                {workingLabel === "schedule" ? "Saving..." : "Create schedule"}
              </button>

              <div className="mt-5 space-y-3">
                {schedules.map((schedule) => (
                  <div
                    className="rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-3"
                    key={schedule.id}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium">{schedule.name}</div>
                          {schedule.backend ? (
                            <span className="rounded-full border border-violet-400/25 bg-violet-400/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-violet-200">
                              Longhorn native
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {schedule.cron} · {schedule.appRefs.length} workload
                          {schedule.appRefs.length === 1 ? "" : "s"}
                        </div>
                        {schedule.appDisplayNames?.length ? (
                          <div className="mt-1 text-xs text-slate-400">
                            {schedule.appDisplayNames.slice(0, 3).join(", ")}
                            {schedule.appDisplayNames.length > 3
                              ? ` +${schedule.appDisplayNames.length - 3} more`
                              : ""}
                            {typeof schedule.activeVolumeCount === "number"
                              ? ` · ${schedule.activeVolumeCount} Longhorn volume${schedule.activeVolumeCount === 1 ? "" : "s"}`
                              : ""}
                          </div>
                        ) : null}
                        <div className="mt-1 text-xs text-slate-400">
                          Next run: {formatTimestamp(schedule.nextRunAt)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-full border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-sky-400/40"
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
                          className="rounded-full border border-rose-400/25 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-400/10"
                          onClick={() => void deleteExistingSchedule(schedule)}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="panel rounded-3xl p-5 sm:p-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Backup catalog</h2>
                <p className="mt-1 text-slate-400">
                  Restore backup sets into a safe clone namespace or detached PVCs.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100"
                  onChange={(event) => setRestoreMode(event.target.value as RestoreMode)}
                  value={restoreMode}
                >
                  <option value="clone-workload">Clone workload</option>
                  <option value="pvc-only">PVC-only restore</option>
                </select>
                <input
                  className="rounded-full border border-slate-700 bg-slate-950/60 px-4 py-2 text-slate-100"
                  onChange={(event) => setRestoreNamespace(event.target.value)}
                  placeholder={defaultCloneNamespace}
                  value={restoreNamespace}
                />
                <button
                  className="inline-flex items-center gap-2 rounded-full bg-violet-400 px-4 py-2 font-medium text-slate-950 transition hover:bg-violet-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                  disabled={restoreDisabled}
                  onClick={() => void runRestore()}
                  type="button"
                >
                  <ArrowDownToLine className="h-4 w-4" />
                  {workingLabel === "restore"
                    ? "Queueing..."
                    : `Restore ${selectedBackupSets.length || ""}`.trim()}
                </button>
              </div>
            </div>
            <div
              className={`mb-4 rounded-2xl border px-4 py-3 text-xs ${
                cloneRestoreSelectionError
                  ? "border-amber-400/25 bg-amber-400/10 text-amber-100"
                  : "border-slate-800 bg-slate-950/40 text-slate-300"
              }`}
            >
              {restoreMode === "clone-workload"
                ? cloneRestoreSelectionError ||
                  "Clone restore keeps the workload shape for Deployments and StatefulSets. Other backup sets can still be restored as detached PVCs."
                : "PVC-only restore recreates detached Longhorn-backed claims without cloning the workload controller."}
            </div>

            <div className="space-y-3">
              {uiState.backupSets.map((backupSet) => {
                const workloadLabel =
                  getWorkloadLabel(
                    backupSet.namespace,
                    backupSet.workloadKind,
                    backupSet.workloadName,
                  ) || backupSet.currentAppRef;

                return (
                  <label
                    className="flex cursor-pointer flex-col gap-3 rounded-3xl border border-slate-800 bg-slate-950/40 p-4 transition hover:border-violet-400/30 hover:bg-slate-950/60"
                    key={backupSet.id}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            checked={selectedBackupSets.includes(backupSet.id)}
                            className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-violet-400"
                            onChange={() =>
                              toggleSelection(
                                selectedBackupSets,
                                setSelectedBackupSets,
                                backupSet.id,
                              )
                            }
                            type="checkbox"
                          />
                          <span className="text-base font-medium">{backupSet.displayName}</span>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                          <span>
                            {backupSet.volumeCount} volume
                            {backupSet.volumeCount === 1 ? "" : "s"}
                          </span>
                          <span>·</span>
                          <span>{formatTimestamp(backupSet.createdAt)}</span>
                          {backupSet.requestedBy ? (
                            <>
                              <span>·</span>
                              <span>{backupSet.requestedBy}</span>
                            </>
                          ) : null}
                        </div>
                        {workloadLabel ? (
                          <div className="break-all text-xs text-slate-500">
                            {workloadLabel}
                          </div>
                        ) : null}
                        {!backupSet.cloneRestoreSupported ? (
                          <div className="text-xs text-amber-200/80">
                            {backupSet.cloneRestoreBlockedReason}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
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
                              : "border-slate-700 bg-slate-900/80 text-slate-300"
                          }`}
                        >
                          {backupSet.cloneRestoreSupported ? "Clone ready" : "PVC-only"}
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/50 px-3 py-3">
                        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                          Captured volumes
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {backupSet.volumes.map((volume) => (
                            <span
                              className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs text-slate-300"
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
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="panel rounded-3xl p-5 sm:p-6">
            <h2 className="text-xl font-semibold">Runs and progress</h2>
            <p className="mt-1 text-slate-400">
              Operations poll live so you can see queued, active, and finished work.
            </p>

            <div className="mt-4 space-y-4">
              {uiState.operations.map((operation) => (
                <article
                  className="rounded-3xl border border-slate-800 bg-slate-950/40 p-4"
                  key={operation.id}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="font-medium">{operation.summary}</div>
                      <div className="mt-1 text-xs text-slate-400">
                        {operation.requestedBy} · {formatTimestamp(operation.createdAt)}
                      </div>
                    </div>
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(
                        operation.status,
                      )}`}
                    >
                      {operation.status}
                    </span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {operation.items.map((item) => {
                      const podContext = getOperationPodContext(item);

                      return (
                        <details
                          className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3"
                          key={item.id}
                        >
                          <summary className="cursor-pointer list-none">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                              <div className="font-medium">{item.displayName}</div>
                              <div className="mt-1 text-xs text-slate-400">
                                {item.message || "Waiting for the next step..."}
                              </div>
                              </div>
                              <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(
                                item.status,
                              )}`}
                              >
                              {item.status}
                              </span>
                            </div>
                            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-900">
                              <div
                              className="h-full rounded-full bg-sky-400 transition-all"
                              style={{ width: `${Math.max(item.progress, 4)}%` }}
                              />
                            </div>
                          </summary>

                          <div className="mt-4 grid gap-3">
                            {(item.appRef || item.backupSetId) && (
                              <WorkloadPodPanel
                              emptyMessage="No current cluster pods are mapped to this workload."
                              podCount={podContext.podCount}
                              pods={podContext.pods}
                              readyPodCount={podContext.readyPodCount}
                              workloadLabel={podContext.workloadLabel}
                              />
                            )}

                            {item.volumes.map((volume, index) => (
                              <div
                              className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-3 text-xs text-slate-300"
                              key={`${item.id}-${index}`}
                              >
                              <div className="flex items-center justify-between gap-3">
                                <div className="font-medium text-slate-100">
                                  {volume.pvcName || volume.volumeName || "Volume"}
                                </div>
                                <span
                                  className={`inline-flex rounded-full border px-2 py-1 ${badgeClass(
                                    volume.status,
                                  )}`}
                                >
                                  {volume.status}
                                </span>
                              </div>
                              {volume.message ? (
                                <div className="mt-2 text-rose-200">{volume.message}</div>
                              ) : null}
                              {(volume.backupName ||
                                volume.snapshotName ||
                                volume.restoredClaimName) && (
                                  <div className="mt-2 space-y-1 text-slate-400">
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
                              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-3">
                              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                                Timeline
                              </div>
                              <div className="space-y-2">
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
                                          ? "text-rose-200"
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
                        </details>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {uiState.loading ? (
          <div className="fixed inset-x-0 bottom-4 flex justify-center">
            <div className="rounded-full border border-slate-700 bg-slate-950/80 px-4 py-2 text-xs text-slate-300">
              Loading cluster state...
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
