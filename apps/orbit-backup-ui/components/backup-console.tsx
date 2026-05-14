"use client";

import type { ComponentType, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Cloud,
  DatabaseBackup,
  House,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Workflow,
} from "lucide-react";

import {
  getCloneRestoreBatchValidationError,
  getInPlaceRestoreBatchValidationError,
  resolveRestoreTargetNamespace,
} from "@/lib/restore";
import type {
  AppInventoryItem,
  BackupMode,
  BackupSetSummary,
  CleanupUnmanagedRequest,
  CleanupUnmanagedResponse,
  DashboardPayload,
  OperationItem,
  OperationRecord,
  PbsStatusSummary,
  PodSummary,
  PurgeBackupSetsResponse,
  RestoreMode,
  ScheduleDefinition,
  UnmanagedInventoryItem,
} from "@/lib/types";

type UiState = {
  dashboard?: DashboardPayload;
  apps: AppInventoryItem[];
  backupSets: BackupSetSummary[];
  unmanagedItems: UnmanagedInventoryItem[];
  operations: OperationRecord[];
  loading: boolean;
  error?: string;
};

type PbsFormState = {
  enabled: boolean;
  server: string;
  datastore: string;
  username: string;
  password: string;
  fingerprint: string;
  backupId: string;
  keepLast: string;
  archiveOnBackup: boolean;
};

type Notice = {
  tone: "success" | "error";
  title: string;
  description: string;
};

type ConsolePage = "home" | "backup" | "restore" | "activity" | "cleanup";

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

type UnmanagedInventoryCardProps = {
  item: UnmanagedInventoryItem;
  cleanupBusy: boolean;
  onCleanup?: () => void;
  onToggleSelect?: () => void;
  selected?: boolean;
};

type SkeletonPanelProps = {
  className?: string;
};

type BottomNavItem = {
  id: ConsolePage;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number;
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

function isConsolePage(value: string): value is ConsolePage {
  return ["home", "backup", "restore", "activity", "cleanup"].includes(value);
}

function getEmptyPbsForm(): PbsFormState {
  return {
    enabled: true,
    server: "",
    datastore: "backups",
    username: "root@pam",
    password: "",
    fingerprint: "",
    backupId: "orbit-backup-ui",
    keepLast: "7",
    archiveOnBackup: true,
  };
}

function SectionHeading({ eyebrow, title, description, actions }: SectionHeadingProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? <div className="section-label">{eyebrow}</div> : null}
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-white sm:text-2xl">
          {title}
        </h2>
        {description ? (
          <p className="mt-2 text-sm text-slate-400 sm:text-[15px]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="min-w-0 flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}

function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state rounded-[28px] px-5 py-8 text-left">
      <div className="text-base font-semibold text-white">{title}</div>
      <p className="overflow-safe mt-2 max-w-2xl text-sm text-slate-400">{description}</p>
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
            <div className="overflow-safe mt-1 text-xs text-slate-500">{workloadLabel}</div>
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
                <span className="max-w-[8rem] truncate font-medium text-white sm:max-w-[12rem]">
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
      data-testid="backup-app-card"
      className={cn(
        "flex cursor-pointer flex-col gap-4 rounded-[28px] border p-4 transition duration-200 sm:p-5",
        selected
          ? "border-sky-400/40 bg-sky-400/10 shadow-[0_24px_70px_rgba(14,165,233,0.12)]"
          : "border-slate-800/90 bg-slate-950/55 hover:border-sky-400/25 hover:bg-slate-950/75",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <input
          checked={selected}
          className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-sky-400"
          onChange={onToggle}
          type="checkbox"
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
             <div className="flex flex-wrap items-center gap-2">
               <span className="break-words text-base font-semibold text-white">
                 {app.displayName}
               </span>
               <span
                 className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(
                   app.status,
                 )}`}
               >
                 {app.status}
               </span>
             </div>
             <div className="overflow-safe mt-1 text-xs text-slate-500">
               {getWorkloadLabel(app.namespace, app.kind, app.name)}
             </div>
             <div className="mt-3 text-sm text-slate-300">
               Protects {pluralize(app.volumes.length, "volume")} for {app.readyPodCount}/
               {app.podCount} ready {pluralize(app.podCount, "pod")}. Last backup{" "}
               {latestBackupAt ? formatTimestamp(latestBackupAt) : "not recorded"}.
             </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-300 sm:max-w-[16rem] sm:justify-end">
             <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1">
               {pluralize(app.volumes.length, "protected volume")}
             </span>
             <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1">
               {app.readyPodCount}/{app.podCount} pods ready
             </span>
            </div>
          </div>

          <div className="space-y-4 border-t border-white/8 pt-4">
            <div>
             <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-slate-500">
               Protected storage
             </div>
             <div className="mt-3 flex flex-wrap gap-2">
               {app.volumes.map((volume) => (
                 <span
                   className="overflow-safe-chip inline-flex max-w-full rounded-full border border-white/8 bg-white/5 px-3 py-1.5 text-left text-xs text-slate-300"
                   key={volume.longhornVolumeName}
                 >
                   {volume.pvcName}
                   {volume.size ? ` · ${volume.size}` : ""}
                 </span>
               ))}
             </div>
            </div>

            <div>
             <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-slate-500">
               Live pods
             </div>
             {app.pods.length > 0 ? (
               <div className="mt-3 flex flex-wrap gap-2">
                 {app.pods.map((pod) => {
                   const tone = getPodTone(pod);
                   return (
                     <span
                       className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${tone.badge}`}
                       key={pod.name}
                     >
                       <span className={`status-dot shrink-0 ${tone.dot}`} />
                       <span className="overflow-safe-chip max-w-full font-medium text-white">
                         {pod.name}
                       </span>
                       <span>{tone.label}</span>
                     </span>
                   );
                 })}
               </div>
             ) : (
               <div className="mt-3 text-xs text-slate-400">
                 Pods will appear here once the workload is scheduled and running.
               </div>
             )}
            </div>
          </div>
        </div>
      </div>
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
        "flex cursor-pointer flex-col gap-4 rounded-[28px] border p-4 transition duration-200 sm:p-5",
        selected
          ? "border-violet-400/40 bg-violet-400/10 shadow-[0_24px_70px_rgba(167,139,250,0.12)]"
          : "border-slate-800/90 bg-slate-950/55 hover:border-violet-400/25 hover:bg-slate-950/75",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <input
          checked={selected}
          className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-violet-400"
          onChange={onToggle}
          type="checkbox"
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-words text-base font-semibold text-white">
                {backupSet.displayName}
              </span>
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
              <div className="overflow-safe mt-1 text-xs text-slate-500">{workloadLabel}</div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-slate-300">
            <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1">
              {pluralize(backupSet.volumeCount, "captured volume")}
            </span>
            <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1">
              Created {formatTimestamp(backupSet.createdAt)}
            </span>
            {backupSet.requestedBy ? (
              <span className="overflow-safe-chip inline-flex max-w-full rounded-full border border-white/8 bg-white/5 px-3 py-1 text-left">
                Requested by {backupSet.requestedBy}
              </span>
            ) : null}
          </div>

          {!backupSet.cloneRestoreSupported && backupSet.cloneRestoreBlockedReason ? (
          <div className="overflow-safe rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs text-amber-100">
              {backupSet.cloneRestoreBlockedReason}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-[24px] border border-white/8 bg-slate-950/65 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">
              Captured volumes
            </div>
            <div className="text-xs text-slate-400">{pluralize(backupSet.volumeCount, "set")}</div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {backupSet.volumes.map((volume) => (
              <span
                className="overflow-safe-chip inline-flex max-w-full rounded-full border border-white/8 bg-white/5 px-3 py-1.5 text-left text-xs text-slate-300"
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
}

function UnmanagedInventoryCard({
  item,
  cleanupBusy,
  onCleanup,
  onToggleSelect,
  selected = false,
}: UnmanagedInventoryCardProps) {
  const confidenceBadge =
    item.confidence === "high"
      ? "border-amber-400/25 bg-amber-400/10 text-amber-100"
      : "border-slate-400/25 bg-slate-400/10 text-slate-200";
  const sourceBadge =
    item.source === "restore-artifact"
      ? "border-sky-400/25 bg-sky-400/10 text-sky-100"
      : "border-violet-400/25 bg-violet-400/10 text-violet-100";

  return (
    <div className="flex flex-col gap-4 rounded-[28px] border border-slate-800/90 bg-slate-950/55 p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-words text-base font-semibold text-white">
                {item.displayName}
              </span>
              <span
                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${confidenceBadge}`}
              >
                {item.confidence === "high" ? "High confidence" : "Needs review"}
              </span>
              <span
                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${sourceBadge}`}
              >
                {item.source === "restore-artifact" ? "Restore/test signal" : "No Argo owner"}
              </span>
            </div>
            <div className="mt-1 break-all text-xs text-slate-500">
              {getWorkloadLabel(item.namespace, item.kind, item.name)}
            </div>
          </div>

          <p className="text-sm text-slate-300">{item.managementSummary}</p>

          <div className="flex flex-wrap gap-2 text-xs text-slate-300">
            <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1">
              Kind {item.kind}
            </span>
            <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1">
              Created {formatTimestamp(item.createdAt)}
            </span>
            {item.podCount > 0 ? (
              <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1">
                {item.readyPodCount}/{item.podCount} pods ready
              </span>
            ) : null}
          </div>
        </div>

        <div className="w-full shrink-0 rounded-[24px] border border-white/8 bg-slate-900/75 px-4 py-4 lg:w-64">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
            Cleanup actions
          </div>
          <div className="mt-2 text-sm text-slate-300">
            {item.source === "restore-artifact"
              ? "High-signal restore/test artifact."
              : "Manual review candidate only."}
          </div>
          <div className="mt-4 space-y-2">
            {onCleanup ? (
              <>
                <button
                  className="w-full rounded-full border border-amber-400/25 bg-amber-400/12 px-3 py-2 text-xs font-medium text-amber-50 transition hover:border-amber-300/40 hover:bg-amber-400/18 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={cleanupBusy}
                  onClick={onCleanup}
                  type="button"
                >
                  {cleanupBusy ? "Cleaning..." : "Clean now"}
                </button>
                <button
                  className={cn(
                    "w-full rounded-full border px-3 py-2 text-xs font-medium transition",
                    selected
                      ? "border-sky-400/30 bg-sky-400/12 text-sky-50"
                      : "border-white/10 bg-white/5 text-slate-300 hover:border-sky-400/20 hover:text-white",
                  )}
                  disabled={cleanupBusy}
                  onClick={onToggleSelect}
                  type="button"
                >
                  {selected ? "Selected for batch cleanup" : "Select for batch cleanup"}
                </button>
              </>
            ) : (
              <div className="rounded-[18px] border border-white/8 bg-white/5 px-3 py-2 text-center text-xs text-slate-400">
                Manual review only
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-[24px] border border-white/8 bg-slate-950/65 px-4 py-4">
        <div className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">
          Why Orbit flagged this
        </div>
        <div className="mt-4 space-y-3">
          {item.reasons.map((reason) => (
            <div
              className="rounded-[20px] border border-white/8 bg-white/5 px-4 py-3"
              key={`${item.ref}:${reason.summary}`}
            >
              <div className="text-sm font-medium text-white">{reason.summary}</div>
              <div className="mt-1 text-xs text-slate-400">{reason.detail}</div>
            </div>
          ))}
        </div>
      </div>

      {item.podCount > 0 ? (
        <WorkloadPodPanel
          emptyMessage="No live pods are currently mapped to this unmanaged resource."
          podCount={item.podCount}
          pods={item.pods}
          readyPodCount={item.readyPodCount}
          workloadLabel={item.displayName}
        />
      ) : null}
    </div>
  );
}

function BottomNav({
  items,
  activePage,
  onSelect,
}: {
  items: BottomNavItem[];
  activePage: ConsolePage;
  onSelect: (page: ConsolePage) => void;
}) {
  return (
    <div className="bottom-nav-shell fixed inset-x-0 bottom-0 z-30">
      <div className="mx-auto max-w-[94rem] px-3 pb-3 sm:px-5 lg:px-8">
        <nav className="panel rounded-[26px] border border-white/10 bg-slate-950/88 p-2 shadow-[0_30px_80px_rgba(2,6,23,0.6)]">
          <div className="grid grid-cols-5 gap-1">
            {items.map(({ id, label, icon: Icon, badge }) => (
              <button
                className={cn(
                  "flex flex-col items-center justify-center gap-1 rounded-[20px] px-2 py-2.5 text-center text-[11px] font-medium transition sm:text-xs",
                  activePage === id
                    ? "bg-sky-400/12 text-sky-50"
                    : "text-slate-400 hover:bg-white/5 hover:text-white",
                )}
                data-testid={`nav-${id}`}
                key={id}
                onClick={() => onSelect(id)}
                type="button"
              >
                <div className="relative">
                  <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                  {badge ? (
                    <span className="absolute -right-3 -top-2 inline-flex min-w-[1.1rem] items-center justify-center rounded-full border border-slate-950 bg-sky-400 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  ) : null}
                </div>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>
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
    unmanagedItems: [],
    operations: [],
    loading: true,
  });
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [selectedBackupSets, setSelectedBackupSets] = useState<string[]>([]);
  const [backupMode, setBackupMode] = useState<BackupMode>("incremental");
  const [restoreMode, setRestoreMode] = useState<RestoreMode>("in-place");
  const [restoreNamespace, setRestoreNamespace] = useState("");
  const [scheduleName, setScheduleName] = useState("");
  const [scheduleCron, setScheduleCron] = useState("0 3 * * *");
  const [scheduleRetain, setScheduleRetain] = useState("7");
  const [scheduleRetainDrafts, setScheduleRetainDrafts] = useState<Record<string, string>>({});
  const [targetUrl, setTargetUrl] = useState("");
  const [targetSecret, setTargetSecret] = useState("");
  const [targetPollInterval, setTargetPollInterval] = useState("300s");
  const [targetDirty, setTargetDirty] = useState(false);
  const [longhornDestinationEnabled, setLonghornDestinationEnabled] = useState(true);
  const [destinationDirty, setDestinationDirty] = useState(false);
  const [pbsStatus, setPbsStatus] = useState<PbsStatusSummary | null>(null);
  const [pbsForm, setPbsForm] = useState<PbsFormState>(getEmptyPbsForm());
  const [pbsDirty, setPbsDirty] = useState(false);
  const [workingLabel, setWorkingLabel] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [unmanagedFilter, setUnmanagedFilter] = useState<"all" | "high" | "review">("all");
  const [selectedUnmanagedRefs, setSelectedUnmanagedRefs] = useState<string[]>([]);
  const [activePage, setActivePage] = useState<ConsolePage>("home");

  const refresh = useCallback(async () => {
    setIsRefreshing(true);

    try {
      const [dashboardResponse, appsResponse, backupResponse, operationsResponse] =
        await Promise.all([
          fetchJson<DashboardPayload>("/api/dashboard"),
          fetchJson<{
            apps: AppInventoryItem[];
            unmanagedItems: UnmanagedInventoryItem[];
          }>("/api/apps"),
          fetchJson<{ backupSets: BackupSetSummary[] }>("/api/backups"),
          fetchJson<{ operations: OperationRecord[] }>("/api/operations"),
        ]);

      setUiState({
        dashboard: dashboardResponse,
        apps: appsResponse.apps,
        backupSets: backupResponse.backupSets,
        unmanagedItems: appsResponse.unmanagedItems,
        operations: operationsResponse.operations,
        loading: false,
      });
      setSelectedUnmanagedRefs((previous) =>
        previous.filter((ref) =>
          appsResponse.unmanagedItems.some(
            (item) => item.ref === ref && item.confidence === "high",
          ),
        ),
      );

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

  const refreshPbs = useCallback(async () => {
    try {
      const response = await fetchJson<{ pbs: PbsStatusSummary }>("/api/pbs");
      setPbsStatus(response.pbs);
      if (!pbsDirty) {
        setPbsForm((current) => ({
          ...current,
          enabled: response.pbs.enabled,
          server: response.pbs.server || "",
          datastore: response.pbs.datastore || "backups",
          username: response.pbs.username || "root@pam",
          password: "",
          fingerprint: response.pbs.fingerprint || "",
          backupId: response.pbs.backupId || "orbit-backup-ui",
          keepLast: String(response.pbs.keepLast ?? 7),
          archiveOnBackup: response.pbs.archiveOnBackup,
        }));
      }
    } catch (error) {
      setPbsStatus((current) =>
        current
          ? {
              ...current,
              reachable: false,
              error: getErrorMessage(error, "PBS status refresh failed."),
            }
          : null,
      );
    }
  }, [pbsDirty]);

  const refreshDestinations = useCallback(async () => {
    try {
      const response = await fetchJson<{ longhornEnabled: boolean }>("/api/destinations");
      if (!destinationDirty) {
        setLonghornDestinationEnabled(response.longhornEnabled);
      }
    } catch {
      // destination toggles should not block the rest of the console
    }
  }, [destinationDirty]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 5_000);

    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (activePage !== "backup") {
      return;
    }

    void refreshPbs();
    void refreshDestinations();
    const interval = setInterval(() => {
      void refreshPbs();
      void refreshDestinations();
    }, 60_000);

    return () => clearInterval(interval);
  }, [activePage, refreshDestinations, refreshPbs]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const applyHash = () => {
      const value = window.location.hash.replace(/^#/, "");
      if (isConsolePage(value)) {
        setActivePage(value);
      } else if (!value) {
        setActivePage("home");
      }
    };

    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextHash = activePage === "home" ? "" : `#${activePage}`;
    if (window.location.hash !== nextHash) {
      const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;
      window.history.replaceState(null, "", nextUrl);
    }
  }, [activePage]);

  const protectedApps = useMemo(
    () => uiState.apps.filter((app) => app.volumes.length > 0),
    [uiState.apps],
  );
  const highConfidenceUnmanaged = useMemo(
    () => uiState.unmanagedItems.filter((item) => item.confidence === "high"),
    [uiState.unmanagedItems],
  );
  const reviewUnmanaged = useMemo(
    () => uiState.unmanagedItems.filter((item) => item.confidence === "review"),
    [uiState.unmanagedItems],
  );
  const visibleUnmanagedItems = useMemo(() => {
    switch (unmanagedFilter) {
      case "high":
        return highConfidenceUnmanaged;
      case "review":
        return reviewUnmanaged;
      default:
        return uiState.unmanagedItems;
    }
  }, [
    highConfidenceUnmanaged,
    reviewUnmanaged,
    uiState.unmanagedItems,
    unmanagedFilter,
  ]);
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
  const inPlaceRestoreSelectionError = useMemo(
    () =>
      restoreMode === "in-place"
        ? getInPlaceRestoreBatchValidationError(selectedBackupSetRecords)
        : undefined,
    [restoreMode, selectedBackupSetRecords],
  );
  const restoreSelectionError =
    restoreMode === "clone-workload"
      ? cloneRestoreSelectionError
      : inPlaceRestoreSelectionError;
  const restoreDisabled =
    selectedBackupSets.length === 0 ||
    workingLabel === "restore" ||
    Boolean(restoreSelectionError);

  const defaultRestoreNamespace = useMemo(() => {
    const selected = uiState.backupSets.find((backupSet) =>
      selectedBackupSets.includes(backupSet.id),
    );
    return resolveRestoreTargetNamespace(restoreMode, selected);
  }, [restoreMode, selectedBackupSets, uiState.backupSets]);

  useEffect(() => {
    if (!restoreNamespace) {
      setRestoreNamespace(defaultRestoreNamespace);
    }
  }, [defaultRestoreNamespace, restoreNamespace]);

  useEffect(() => {
    setSelectedApps((previous) => previous.filter((ref) => appByRef.has(ref)));
  }, [appByRef]);

  useEffect(() => {
    setSelectedBackupSets((previous) => previous.filter((id) => backupSetById.has(id)));
  }, [backupSetById]);

  useEffect(() => {
    const cleanupEligibleRefs = new Set(highConfidenceUnmanaged.map((item) => item.ref));
    setSelectedUnmanagedRefs((previous) =>
      previous.filter((ref) => cleanupEligibleRefs.has(ref)),
    );
  }, [highConfidenceUnmanaged]);

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
    if (selectedApps.length === 0 || !longhornDestinationEnabled) {
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
        setActivePage("activity");
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
          targetNamespace: restoreMode === "in-place" ? undefined : restoreNamespace,
        });
        await refresh();
        setActivePage("activity");
      },
      "Restore queued",
      `${pluralize(selectedBackupSets.length, "backup set")} added to the restore queue in ${restoreMode} mode.`,
      "Could not queue the restore",
    );
  };

  const runUnmanagedCleanup = async (refs: string[]) => {
    const cleanupRefs = [...new Set(refs.filter(Boolean))];
    if (cleanupRefs.length === 0) {
      return;
    }

    setWorkingLabel("cleanup");
    setNotice(null);

    try {
      const result = await sendJson<CleanupUnmanagedResponse>(
        "/api/unmanaged",
        "POST",
        {
          refs: cleanupRefs,
        } satisfies CleanupUnmanagedRequest,
      );
      const deletedRefs = new Set(result.deleted.map((item) => item.ref));
      setSelectedUnmanagedRefs((previous) =>
        previous.filter((ref) => !deletedRefs.has(ref)),
      );
      await refresh();

      const details: string[] = [];
      if (result.deleted.length > 0) {
        details.push(`Removed ${pluralize(result.deleted.length, "resource")}.`);
      }
      if (result.skipped.length > 0) {
        details.push(
          `${pluralize(result.skipped.length, "item")} skipped because they were no longer safe to delete.`,
        );
      }

      setNotice({
        tone: "success",
        title: result.deleted.length > 0 ? "Cleanup finished" : "Nothing deleted",
        description:
          details.join(" ") ||
          "Orbit did not delete anything because nothing remained eligible for cleanup.",
      });
      setActivePage("cleanup");
    } catch (error) {
      setNotice({
        tone: "error",
        title: "Could not clean up unmanaged items",
        description: getErrorMessage(error, "Please try again."),
      });
    } finally {
      setWorkingLabel(null);
    }
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

  const saveDestinationPreferences = async () => {
    await runManagedAction(
      "destinations",
      async () => {
        await sendJson("/api/destinations", "PUT", {
          longhornEnabled: longhornDestinationEnabled,
        });
        setDestinationDirty(false);
        await refreshDestinations();
      },
      "Destinations updated",
      "Orbit saved the active backup-destination toggles.",
      "Could not save backup destinations",
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
          retain: Number(scheduleRetain),
        });
        setScheduleName("");
        setScheduleRetain("7");
        await refresh();
      },
      "Schedule created",
      `${scheduleName.trim()} will protect ${pluralize(selectedApps.length, "selected workload")}.`,
      "Could not create the schedule",
    );
  };

  const updateScheduleRetention = async (schedule: ScheduleDefinition) => {
    const retain = Number(scheduleRetainDrafts[schedule.id] || schedule.retain || 7);
    if (!Number.isInteger(retain) || retain < 1) {
      setNotice({
        tone: "error",
        title: "Retention must be a positive number",
        description: "Enter how many recurring backups Longhorn should keep for this schedule.",
      });
      return;
    }

    await runManagedAction(
      `schedule-retain:${schedule.id}`,
      async () => {
        await sendJson("/api/schedules", "PUT", {
          id: schedule.id,
          retain,
        });
        await refresh();
      },
      "Retention updated",
      `${schedule.name} will now keep ${pluralize(retain, "backup")}.`,
      "Could not update schedule retention",
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

  const purgeSelectedBackupSets = async () => {
    if (selectedBackupSets.length === 0) {
      return;
    }

    await runManagedAction(
      "purge-backups",
      async () => {
        const result = await sendJson<PurgeBackupSetsResponse>("/api/backups", "DELETE", {
          setIds: selectedBackupSets,
        });
        setSelectedBackupSets([]);
        await refresh();

        const details: string[] = [];
        if (result.deleted.length > 0) {
          details.push(`Purged ${pluralize(result.deleted.length, "backup set")}.`);
        }
        if (result.skipped.length > 0) {
          details.push(`${pluralize(result.skipped.length, "set")} skipped.`);
        }

        setNotice({
          tone: "success",
          title: result.deleted.length > 0 ? "Backup purge finished" : "Nothing purged",
          description:
            details.join(" ") ||
            "Orbit did not remove any backup sets because none were still available.",
        });
      },
      "Backup purge finished",
      `${pluralize(selectedBackupSets.length, "backup set")} removed from the Longhorn catalog.`,
      "Could not purge the selected backup sets",
    );
  };

  const savePbsConfig = async () => {
    await runManagedAction(
      "pbs",
      async () => {
        const response = await sendJson<{ pbs: PbsStatusSummary }>("/api/pbs", "PUT", {
          enabled: pbsForm.enabled,
          server: pbsForm.server,
          datastore: pbsForm.datastore,
          username: pbsForm.username,
          password: pbsForm.password,
          fingerprint: pbsForm.fingerprint,
          backupId: pbsForm.backupId,
          keepLast: Number(pbsForm.keepLast),
          archiveOnBackup: pbsForm.archiveOnBackup,
        });
        setPbsStatus(response.pbs);
        setPbsForm((current) => ({
          ...current,
          password: "",
          fingerprint: response.pbs.fingerprint || current.fingerprint,
        }));
        setPbsDirty(false);
      },
      "PBS settings saved",
      "Orbit validated the Proxmox Backup Server settings and saved the archive mirror profile.",
      "Could not save the PBS settings",
    );
  };

  const runPbsAction = async (action: "test" | "archive" | "prune") => {
    const messages = {
      test: {
        successTitle: "PBS connection checked",
        successDescription: "Orbit refreshed the PBS group status and snapshot list.",
        errorTitle: "Could not validate PBS",
      },
      archive: {
        successTitle: "PBS archive uploaded",
        successDescription:
          "Orbit uploaded a fresh backup catalog archive and refreshed the PBS snapshot list.",
        errorTitle: "Could not archive to PBS",
      },
      prune: {
        successTitle: "PBS prune finished",
        successDescription: "Orbit applied the keep-last policy to the PBS archive group.",
        errorTitle: "Could not prune PBS archives",
      },
    } as const;

    await runManagedAction(
      `pbs-${action}`,
      async () => {
        const response = await sendJson<{ pbs: PbsStatusSummary }>("/api/pbs", "POST", {
          action,
        });
        setPbsStatus(response.pbs);
        setPbsForm((current) => ({
          ...current,
          password: "",
          fingerprint: response.pbs.fingerprint || current.fingerprint,
        }));
      },
      messages[action].successTitle,
      messages[action].successDescription,
      messages[action].errorTitle,
    );
  };

  const targets = useMemo(() => uiState.dashboard?.targets ?? [], [uiState.dashboard?.targets]);
  const schedules = useMemo(
    () => uiState.dashboard?.schedules ?? [],
    [uiState.dashboard?.schedules],
  );
  const overview = uiState.dashboard?.overview;

  useEffect(() => {
    setScheduleRetainDrafts((previous) => {
      const next: Record<string, string> = {};
      for (const schedule of schedules) {
        next[schedule.id] = previous[schedule.id] ?? String(schedule.retain ?? 7);
      }
      return next;
    });
  }, [schedules]);

  const activeSchedules = schedules.filter((schedule) => schedule.enabled).length;
  const healthyTargetCount = targets.filter((target) => target.available).length;
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
    uiState.unmanagedItems.length > 0 ||
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
  const pbsSnapshots = pbsStatus?.snapshots ?? [];
  const pbsKeepLast = Number(pbsForm.keepLast || "0");
  const pbsConfigReady =
    Boolean(pbsForm.server.trim()) &&
    Boolean(pbsForm.datastore.trim()) &&
    Boolean(pbsForm.username.trim()) &&
    (Boolean(pbsForm.password.trim()) || Boolean(pbsStatus?.passwordConfigured));
  const pbsStatusLabel = !pbsStatus?.configured
    ? "Not configured"
    : pbsStatus.reachable
      ? "Reachable"
      : pbsStatus.enabled
        ? "Needs attention"
        : "Saved";
  const runningOperations = overview?.runningOperations ?? 0;
  const backupsLastWeek = uiState.backupSets.filter((backupSet) => {
    if (!backupSet.createdAt) {
      return false;
    }

    return Date.now() - new Date(backupSet.createdAt).getTime() <= 7 * 24 * 60 * 60 * 1000;
  }).length;
  const latestBackupByAppRef = useMemo(() => {
    const latest = new Map<
      string,
      { status: OperationItem["status"]; timestamp: number; displayName: string; message?: string }
    >();

    for (const operation of uiState.operations) {
      if (operation.type !== "backup") {
        continue;
      }

      const timestamp = new Date(
        operation.finishedAt || operation.startedAt || operation.createdAt,
      ).getTime();

      for (const item of operation.items) {
        if (!item.appRef) {
          continue;
        }

        const current = latest.get(item.appRef);
        if (!current || timestamp >= current.timestamp) {
          latest.set(item.appRef, {
            status: item.status,
            timestamp,
            displayName: item.displayName,
            message: item.message,
          });
        }
      }
    }

    return latest;
  }, [uiState.operations]);
  const failedLatestBackups = protectedApps
    .map((app) => ({
      app,
      latest: latestBackupByAppRef.get(app.ref),
    }))
    .filter(
      (
        entry,
      ): entry is {
        app: AppInventoryItem;
        latest: { status: OperationItem["status"]; timestamp: number; displayName: string; message?: string };
      } => entry.latest?.status === "failed",
    );

  const pageItems: BottomNavItem[] = [
    {
      id: "home",
      label: "Home",
      description: "Status, counts, and quick actions",
      icon: House,
    },
    {
      id: "backup",
      label: "Backup",
      description: "Pick workloads, schedules, and targets",
      icon: ArrowUpFromLine,
      badge: selectedApps.length > 0 ? selectedApps.length : undefined,
    },
    {
      id: "restore",
      label: "Restore",
      description: "Recover apps from the backup catalog",
      icon: ArrowDownToLine,
      badge: selectedBackupSets.length > 0 ? selectedBackupSets.length : undefined,
    },
    {
      id: "activity",
      label: "Activity",
      description: "Track live runs and progress",
      icon: Activity,
      badge: runningOperations > 0 ? runningOperations : undefined,
    },
    {
      id: "cleanup",
      label: "Cleanup",
      description: "Review and remove orphaned resources",
      icon: Trash2,
      badge:
        selectedUnmanagedRefs.length > 0
          ? selectedUnmanagedRefs.length
          : highConfidenceUnmanaged.length > 0
            ? highConfidenceUnmanaged.length
            : undefined,
    },
  ];

  const homePage = (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Schedules",
            value: schedules.length,
            detail:
              schedules.length > 0
                ? `${pluralize(activeSchedules, "active schedule")} right now`
                : "No recurring protection configured",
            icon: Workflow,
            tone: "from-violet-400/20 via-violet-400/5 to-transparent",
          },
          {
            label: "Backups this week",
            value: backupsLastWeek,
            detail:
              backupsLastWeek > 0
                ? `${pluralize(uiState.backupSets.length, "catalog entry")} currently visible`
                : "No backups captured in the last 7 days",
            icon: DatabaseBackup,
            tone: "from-sky-400/20 via-sky-400/5 to-transparent",
          },
          {
            label: "Failed last backup",
            value: failedLatestBackups.length,
            detail:
              failedLatestBackups.length > 0
                ? `${pluralize(failedLatestBackups.length, "workload")} needs attention`
                : "Latest backup is healthy across protected workloads",
            icon: ShieldAlert,
            tone: "from-rose-400/20 via-rose-400/5 to-transparent",
          },
          {
            label: "Backup targets",
            value: targetStatusLabel,
            detail:
              targets.length > 0
                ? defaultTarget?.backupTargetURL || "Target is configured"
                : "Save a Longhorn target to start writing backups",
            icon: Cloud,
            tone: "from-emerald-400/20 via-emerald-400/5 to-transparent",
          },
        ].map(({ label, value, detail, icon: Icon, tone }) => (
          <div className={`panel rounded-[28px] bg-gradient-to-br ${tone} p-5`} key={label}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="section-label">{label}</div>
                <div className="mt-4 text-3xl font-semibold tracking-tight text-white">
                  {value}
                </div>
                <div className="mt-2 text-sm text-slate-400">{detail}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/6 p-3">
                <Icon className="h-5 w-5 text-slate-200" />
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="panel rounded-[32px] p-5 sm:p-6">
          <SectionHeading
            description="Move straight into backup, restore, activity, or orphan cleanup without scrolling through the whole console."
            eyebrow="Quick actions"
            title="Open the page you need"
          />

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {pageItems
              .filter((item) => item.id !== "home")
              .map(({ id, label, description, icon: Icon, badge }) => (
                <button
                  className="flex items-start justify-between gap-3 rounded-[24px] border border-white/8 bg-slate-950/60 px-4 py-4 text-left transition hover:border-sky-400/25 hover:bg-slate-950/80"
                  key={id}
                  onClick={() => setActivePage(id)}
                  type="button"
                >
                  <div className="flex min-w-0 gap-3">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                      <Icon className="h-4 w-4 text-slate-100" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-white">{label}</div>
                      <div className="mt-1 text-sm text-slate-400">{description}</div>
                    </div>
                  </div>
                  {badge ? (
                    <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-2.5 py-1 text-xs font-medium text-sky-100">
                      {badge}
                    </span>
                  ) : null}
                </button>
              ))}
          </div>
        </section>

        <section className="panel rounded-[32px] p-5 sm:p-6">
          <SectionHeading
            description="The home page keeps only the operational summary that matters once the workflows are already in place."
            eyebrow="Operational summary"
            title="Cluster backup health"
          />

          <div className="mt-5 grid gap-3">
            <div className="rounded-[24px] border border-white/8 bg-slate-950/60 px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                Target status
              </div>
              <div className="mt-2 text-lg font-semibold text-white">{targetStatusLabel}</div>
              <div className="mt-2 break-all text-sm text-slate-400">
                {defaultTarget?.backupTargetURL || "No target URL configured yet."}
              </div>
            </div>

            <div className="rounded-[24px] border border-white/8 bg-slate-950/60 px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                Recent failures
              </div>
              {failedLatestBackups.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {failedLatestBackups.slice(0, 3).map(({ latest }, index) => (
                    <div
                      className="rounded-[20px] border border-rose-400/15 bg-rose-400/10 px-4 py-3"
                      key={`${latest.displayName}-${index}`}
                    >
                      <div className="font-medium text-rose-50">{latest.displayName}</div>
                      <div className="overflow-safe mt-1 text-xs text-rose-100/80">
                        {latest.message || "The latest backup attempt finished in a failed state."}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 text-sm text-slate-400">
                  No protected workload is currently flagged as failed on its most recent backup.
                </div>
              )}
            </div>

            <div className="rounded-[24px] border border-white/8 bg-slate-950/60 px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                Schedule posture
              </div>
              {schedules.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {schedules.slice(0, 3).map((schedule) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-white/5 px-3 py-3 text-sm"
                      key={schedule.id}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-white">{schedule.name}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {schedule.cron} · Next {formatTimestamp(schedule.nextRunAt)}
                        </div>
                      </div>
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(
                          schedule.enabled ? "Completed" : "stopped",
                        )}`}
                      >
                        {schedule.enabled ? "Enabled" : "Paused"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 text-sm text-slate-400">
                  No schedules saved yet. Use the backup page to create recurring protection.
                </div>
              )}
            </div>
          </div>
        </section>
      </section>
    </div>
  );

  const backupPage = (
    <div className="space-y-6">
      <section className="panel rounded-[32px] p-5 sm:p-6" data-testid="backup-page-shell">
        <SectionHeading
          description="Choose protected workloads, queue a backup, then tune storage and schedules beneath the same screen."
          eyebrow="Backup"
          title="Protect workloads"
          actions={
            <button
              className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-4 py-2.5 font-medium text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
              disabled={
                selectedApps.length === 0 ||
                workingLabel === "backup" ||
                !longhornDestinationEnabled
              }
              onClick={() => void runBackup()}
              type="button"
            >
              <ArrowUpFromLine className="h-4 w-4" />
              {workingLabel === "backup"
                ? "Queueing backup..."
                : `Back up ${selectedApps.length ? pluralize(selectedApps.length, "app") : "selected apps"}`}
            </button>
          }
        />

        <div
          className="mt-5 rounded-[28px] border border-white/8 bg-slate-950/55 p-4 sm:p-5"
          data-testid="backup-control-card"
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="section-label">Backup run</div>
                <div className="mt-2 text-lg font-semibold text-white">
                  Pick the workloads you want to protect
                </div>
                <div className="mt-2 text-sm text-slate-400">
                  Orbit keeps the backup page focused on PVC-backed apps, so the list below only shows workloads that can actually be restored.
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1.5 font-medium text-sky-100">
                  {pluralize(selectedApps.length, "workload")} selected
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-slate-200">
                  {pluralize(selectedAppVolumeCount, "Longhorn volume")}
                </span>
                <span
                  className={`inline-flex rounded-full border px-3 py-1.5 font-medium ${badgeClass(
                    longhornDestinationEnabled
                      ? defaultTarget?.available
                        ? "Completed"
                        : "failed"
                      : "stopped",
                  )}`}
                >
                  {longhornDestinationEnabled
                    ? defaultTarget?.available
                      ? "Longhorn target ready"
                      : "Longhorn target needs attention"
                    : "Longhorn backups inactive"}
                </span>
              </div>
            </div>

            <div className="border-t border-white/8 pt-4" data-testid="backup-mode-card">
              <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-slate-500">
                Backup mode
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
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
                        : "border-white/10 bg-slate-950/70 text-slate-300 hover:border-sky-400/20 hover:text-white",
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
            </div>

            {!longhornDestinationEnabled ? (
              <div className="rounded-[24px] border border-amber-400/20 bg-amber-400/10 px-4 py-4 text-sm text-amber-50">
                Longhorn volume backups are currently inactive. You can still use PBS archive actions below, but normal app backup runs stay disabled until the Longhorn destination is re-enabled.
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="section-label">Protected workloads</div>
              <div className="mt-2 text-sm text-slate-400">
                Compact cards keep the backup inventory scannable on mobile while still surfacing storage, pod health, and the last backup point.
              </div>
            </div>
            <div className="text-xs text-slate-500">
              {pluralize(protectedApps.length, "eligible workload")}
            </div>
          </div>
          {protectedApps.length > 0 ? (
            <div className="grid gap-4">
              {protectedApps.map((app) => (
                <AppSelectionCard
                  app={app}
                  key={app.ref}
                  onToggle={() => toggleSelection(selectedApps, setSelectedApps, app.ref)}
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

      <section className="grid gap-6">
        <section className="panel rounded-[32px] p-5 sm:p-6">
          <SectionHeading
            description="Point Longhorn at the destination you actually want to use, then save the exact secret reference and poll cadence."
            eyebrow="Target"
            title="Configure backup storage"
          />

          <div className="mt-5 rounded-[28px] border border-white/8 bg-slate-950/55 p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="section-label">Active backup destinations</div>
                <div className="mt-2 text-sm text-slate-400">
                  Toggle where Orbit actively writes backup data or mirrored backup metadata without deleting the saved connection details.
                </div>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200">
                {[
                  longhornDestinationEnabled ? "Longhorn" : null,
                  pbsForm.enabled ? "PBS" : null,
                ]
                  .filter(Boolean)
                  .join(" + ") || "No active destinations"}
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              <div className="rounded-[24px] border border-white/8 bg-white/5 px-4 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium text-white">Longhorn volume backups</div>
                    <div className="mt-1 text-sm text-slate-400">
                      Primary app backup path for PVC volume data using the configured Longhorn target.
                    </div>
                    <div className="mt-2 break-all text-xs text-slate-500">
                      {defaultTarget?.backupTargetURL || "No Longhorn target URL configured"}
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100">
                    <input
                      checked={longhornDestinationEnabled}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-sky-400"
                      onChange={(event) => {
                        setDestinationDirty(true);
                        setLonghornDestinationEnabled(event.target.checked);
                      }}
                      type="checkbox"
                    />
                    Active
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 font-medium ${badgeClass(
                      longhornDestinationEnabled
                        ? defaultTarget?.available
                          ? "Completed"
                          : "failed"
                        : "stopped",
                    )}`}
                  >
                    {longhornDestinationEnabled
                      ? defaultTarget?.available
                        ? "Available"
                        : "Unavailable"
                      : "Inactive"}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">
                    Carries PVC data backups
                  </span>
                </div>
              </div>

              <div className="rounded-[24px] border border-white/8 bg-white/5 px-4 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium text-white">PBS archive mirror</div>
                    <div className="mt-1 text-sm text-slate-400">
                      Mirrors Orbit backup catalog metadata to Proxmox Backup Server after successful backup runs or manual archive requests.
                    </div>
                    <div className="mt-2 break-all text-xs text-slate-500">
                      {pbsStatus?.server ? `${pbsStatus.server}:${pbsStatus.datastore}` : "Configure PBS below"}
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100">
                    <input
                      checked={pbsForm.enabled}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-400"
                      onChange={(event) => {
                        setPbsDirty(true);
                        setPbsForm((current) => ({
                          ...current,
                          enabled: event.target.checked,
                        }));
                      }}
                      type="checkbox"
                    />
                    Active
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 font-medium ${badgeClass(
                      pbsForm.enabled
                        ? pbsStatus?.reachable
                          ? "Completed"
                          : pbsStatus?.configured
                            ? "failed"
                            : "queued"
                        : "stopped",
                    )}`}
                  >
                    {pbsForm.enabled
                      ? pbsStatus?.reachable
                        ? "Reachable"
                        : pbsStatus?.configured
                          ? "Needs attention"
                          : "Not configured"
                      : "Inactive"}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">
                    Catalog metadata mirror
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="rounded-full border border-sky-400/20 bg-sky-400/10 px-4 py-2.5 text-sm font-medium text-sky-100 transition hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!destinationDirty || workingLabel === "destinations"}
                onClick={() => void saveDestinationPreferences()}
                type="button"
              >
                {workingLabel === "destinations" ? "Saving..." : "Save Longhorn toggle"}
              </button>
              {destinationDirty ? (
                <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-100">
                  Longhorn toggle has unsaved changes
                </span>
              ) : null}
            </div>
          </div>

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
              <span>Changes sync to Longhorn and appear in the status cards after the next refresh.</span>
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
                    <div className="min-w-0">
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

          <div className="mt-5 rounded-[28px] border border-white/8 bg-slate-950/55 p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="section-label">PBS archive mirror</div>
                <div className="mt-2 text-sm text-slate-400">
                  Orbit can mirror its backup catalog and recovery metadata to Proxmox Backup Server after successful backup runs. Longhorn remains the source of truth for volume data.
                </div>
              </div>
              <span
                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(
                  pbsStatus?.reachable ? "Completed" : pbsStatus?.configured ? "failed" : "stopped",
                )}`}
              >
                {pbsStatusLabel}
              </span>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <label className="block">
                <span className="field-label">Server</span>
                <input
                  className="mt-2 w-full rounded-[20px] border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/40"
                  onChange={(event) => {
                    setPbsDirty(true);
                    setPbsForm((current) => ({
                      ...current,
                      server: event.target.value,
                    }));
                  }}
                  placeholder="10.0.69.254"
                  value={pbsForm.server}
                />
              </label>

              <label className="block">
                <span className="field-label">Datastore</span>
                <input
                  className="mt-2 w-full rounded-[20px] border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/40"
                  onChange={(event) => {
                    setPbsDirty(true);
                    setPbsForm((current) => ({
                      ...current,
                      datastore: event.target.value,
                    }));
                  }}
                  placeholder="backups"
                  value={pbsForm.datastore}
                />
              </label>

              <label className="block">
                <span className="field-label">Username</span>
                <input
                  className="mt-2 w-full rounded-[20px] border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/40"
                  onChange={(event) => {
                    setPbsDirty(true);
                    setPbsForm((current) => ({
                      ...current,
                      username: event.target.value,
                    }));
                  }}
                  placeholder="root@pam"
                  value={pbsForm.username}
                />
              </label>

              <label className="block">
                <span className="field-label">Password</span>
                <input
                  className="mt-2 w-full rounded-[20px] border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/40"
                  onChange={(event) => {
                    setPbsDirty(true);
                    setPbsForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }));
                  }}
                  placeholder={pbsStatus?.passwordConfigured ? "Saved password" : "Enter PBS password"}
                  type="password"
                  value={pbsForm.password}
                />
              </label>

              <label className="block">
                <span className="field-label">Fingerprint</span>
                <input
                  className="mt-2 w-full rounded-[20px] border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/40"
                  onChange={(event) => {
                    setPbsDirty(true);
                    setPbsForm((current) => ({
                      ...current,
                      fingerprint: event.target.value,
                    }));
                  }}
                  placeholder="Auto-detected on save if omitted"
                  value={pbsForm.fingerprint}
                />
              </label>

              <label className="block">
                <span className="field-label">Backup ID</span>
                <input
                  className="mt-2 w-full rounded-[20px] border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/40"
                  onChange={(event) => {
                    setPbsDirty(true);
                    setPbsForm((current) => ({
                      ...current,
                      backupId: event.target.value,
                    }));
                  }}
                  placeholder="orbit-backup-ui"
                  value={pbsForm.backupId}
                />
              </label>

              <label className="block">
                <span className="field-label">Keep last archives</span>
                <input
                  className="mt-2 w-full rounded-[20px] border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/40"
                  min={1}
                  onChange={(event) => {
                    setPbsDirty(true);
                    setPbsForm((current) => ({
                      ...current,
                      keepLast: event.target.value,
                    }));
                  }}
                  placeholder="7"
                  type="number"
                  value={pbsForm.keepLast}
                />
              </label>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="flex items-center gap-3 rounded-[20px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-slate-200">
                <input
                  checked={pbsForm.archiveOnBackup}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-400"
                  onChange={(event) => {
                    setPbsDirty(true);
                    setPbsForm((current) => ({
                      ...current,
                      archiveOnBackup: event.target.checked,
                    }));
                  }}
                  type="checkbox"
                />
                Upload after successful backup runs
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="inline-flex items-center gap-2 rounded-full bg-emerald-400 px-4 py-2.5 font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                disabled={!pbsConfigReady || workingLabel === "pbs"}
                onClick={() => void savePbsConfig()}
                type="button"
              >
                <Cloud className="h-4 w-4" />
                {workingLabel === "pbs" ? "Saving PBS..." : "Save PBS settings"}
              </button>
              <button
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-emerald-400/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!pbsStatus?.configured || workingLabel === "pbs-test"}
                onClick={() => void runPbsAction("test")}
                type="button"
              >
                {workingLabel === "pbs-test" ? "Testing..." : "Test connection"}
              </button>
              <button
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-emerald-400/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!pbsStatus?.configured || workingLabel === "pbs-archive"}
                onClick={() => void runPbsAction("archive")}
                type="button"
              >
                {workingLabel === "pbs-archive" ? "Archiving..." : "Archive now"}
              </button>
              <button
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-amber-400/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!pbsStatus?.configured || workingLabel === "pbs-prune"}
                onClick={() => void runPbsAction("prune")}
                type="button"
              >
                {workingLabel === "pbs-prune"
                  ? "Pruning..."
                  : `Prune to ${Number.isInteger(pbsKeepLast) && pbsKeepLast > 0 ? pbsKeepLast : "keep-last"}`}
              </button>
            </div>

            <div className="mt-4 rounded-[24px] border border-white/8 bg-white/5 px-4 py-3 text-xs text-slate-400">
              {pbsDirty
                ? "Unsaved PBS changes. Saving also validates the target and stores the server fingerprint if it was omitted."
                : pbsStatus?.lastArchiveAt
                  ? `Last Orbit archive ${formatTimestamp(pbsStatus.lastArchiveAt)}`
                  : "No Orbit archive has been written to PBS yet."}
            </div>

            {pbsStatus?.error ? (
              <div className="mt-4 rounded-[22px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-xs text-rose-100">
                {pbsStatus.error}
              </div>
            ) : null}

            {pbsStatus?.lastArchiveError ? (
              <div className="mt-3 rounded-[22px] border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs text-amber-100">
                Last archive issue: {pbsStatus.lastArchiveError}
              </div>
            ) : null}

            <div className="mt-4 rounded-[24px] border border-white/8 bg-slate-950/60 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                  PBS snapshots for {pbsStatus?.backupId || pbsForm.backupId || "orbit-backup-ui"}
                </div>
                <div className="text-xs text-slate-400">
                  {pluralize(pbsSnapshots.length, "snapshot")}
                </div>
              </div>
              {pbsSnapshots.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {pbsSnapshots.slice(0, 5).map((snapshot) => (
                    <div
                      className="flex flex-col gap-2 rounded-[18px] border border-white/8 bg-white/5 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                      key={snapshot.id}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-white">{snapshot.id}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {formatTimestamp(snapshot.backupTime)}
                        </div>
                      </div>
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(
                          snapshot.protected ? "Completed" : "running",
                        )}`}
                      >
                        {snapshot.protected ? "Protected" : "Mutable"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 text-sm text-slate-400">
                  No Orbit archive snapshots are stored in PBS for this group yet.
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="panel rounded-[32px] p-5 sm:p-6">
          <SectionHeading
            actions={
              <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-xs font-medium text-violet-100">
                {pluralize(activeSchedules, "active schedule")}
              </span>
            }
            description="Schedules reuse the currently selected workloads so the recurring protection plan matches the backup set you just reviewed."
            eyebrow="Schedules"
            title="Manage recurring backups"
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
                    Use the backup page selections to decide which apps this schedule should protect.
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

              <label className="block">
                <span className="field-label">Retention</span>
                <input
                  className="mt-2 w-full rounded-[20px] border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-violet-400/40"
                  min={1}
                  onChange={(event) => setScheduleRetain(event.target.value)}
                  placeholder="7"
                  type="number"
                  value={scheduleRetain}
                />
                <div className="mt-2 text-xs text-slate-500">
                  Longhorn will keep this many recurring backups for each assigned volume.
                </div>
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
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-white">{schedule.name}</div>
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(
                            schedule.enabled ? "Completed" : "stopped",
                          )}`}
                        >
                          {schedule.enabled ? "Enabled" : "Paused"}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-slate-400">
                        {schedule.cron} · {pluralize(schedule.appRefs.length, "workload")}
                        {` · retain ${schedule.retain}`}
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
                      <div className="mt-3 flex flex-wrap items-end gap-2">
                        <label className="min-w-[9rem] flex-1">
                          <span className="field-label">Retain backups</span>
                          <input
                            className="mt-2 w-full rounded-[18px] border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-violet-400/40"
                            min={1}
                            onChange={(event) =>
                              setScheduleRetainDrafts((current) => ({
                                ...current,
                                [schedule.id]: event.target.value,
                              }))
                            }
                            type="number"
                            value={scheduleRetainDrafts[schedule.id] ?? String(schedule.retain)}
                          />
                        </label>
                        <button
                          className="rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-2 text-xs font-medium text-violet-100 transition hover:bg-violet-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={
                            workingLabel === `schedule-retain:${schedule.id}` ||
                            (scheduleRetainDrafts[schedule.id] ?? String(schedule.retain)) ===
                              String(schedule.retain)
                          }
                          onClick={() => void updateScheduleRetention(schedule)}
                          type="button"
                        >
                          {workingLabel === `schedule-retain:${schedule.id}`
                            ? "Saving..."
                            : "Save retention"}
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-violet-400/25 hover:text-white"
                        onClick={() => void setScheduleEnabled(schedule, !schedule.enabled)}
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
      </section>
    </div>
  );

  const restorePage = (
    <section className="panel rounded-[32px] p-5 sm:p-6" data-testid="restore-page-shell">
      <SectionHeading
        description="Review backup sets, choose the safest restore path, and queue only the recovery work you actually want."
        eyebrow="Restore"
        title="Recover apps from the backup catalog"
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-full border border-rose-400/20 bg-rose-400/10 px-4 py-2.5 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={selectedBackupSets.length === 0 || workingLabel === "purge-backups"}
              onClick={() => void purgeSelectedBackupSets()}
              type="button"
            >
              {workingLabel === "purge-backups"
                ? "Purging..."
                : `Purge ${selectedBackupSets.length ? pluralize(selectedBackupSets.length, "set") : "selected sets"}`}
            </button>
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
        }
      />

      <div className="mt-5 grid gap-4">
        <div
          className="rounded-[28px] border border-white/8 bg-slate-950/55 p-4 sm:p-5"
          data-testid="restore-mode-card"
        >
          <div className="section-label">Restore mode</div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {[
              {
                id: "in-place",
                label: "In-place restore",
                description: "Overwrite the live app safely",
              },
              {
                id: "clone-workload",
                label: "Clone workload",
                description: "Validate in a safe namespace",
              },
              {
                id: "pvc-only",
                label: "PVC-only restore",
                description: "Advanced detached claim flow",
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

          <label className="mt-4 block">
            <span className="field-label">Target namespace</span>
            <input
              className="mt-2 w-full rounded-[20px] border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-violet-400/40 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={restoreMode === "in-place"}
              onChange={(event) => setRestoreNamespace(event.target.value)}
              placeholder={defaultRestoreNamespace}
              value={restoreNamespace}
            />
            <div className="mt-2 text-xs text-slate-500">
              {restoreMode === "in-place"
                ? "In-place restore keeps the original namespace and ignores this field."
                : restoreMode === "clone-workload"
                  ? "Orbit suggests a safe clone namespace based on the selected backup set."
                  : "PVC-only restore can recreate detached claims in the namespace you choose."}
            </div>
          </label>
        </div>

        <div
          className="rounded-[28px] border border-violet-400/18 bg-violet-400/10 p-4 sm:p-5"
          data-testid="restore-summary-card"
        >
          <div className="text-[11px] uppercase tracking-[0.24em] text-violet-100/75">
            Restore selection
          </div>
          <div className="mt-3 text-xl font-semibold text-violet-50">
            {pluralize(selectedBackupSets.length, "backup set")}
          </div>
          <div className="mt-2 text-sm text-violet-100/80">
            Covers {pluralize(selectedBackupVolumeCount, "volume")} with {pluralize(
              selectedCloneReadyCount,
              "clone-ready set",
            )}.
          </div>
        </div>
      </div>

      <div
        className={cn(
          "overflow-safe mt-4 rounded-[24px] border px-4 py-4 text-sm",
          restoreSelectionError
            ? "border-amber-400/25 bg-amber-400/10 text-amber-50"
            : "border-white/8 bg-slate-950/55 text-slate-300",
        )}
      >
        {restoreMode === "in-place"
          ? restoreSelectionError ||
            "In-place restore pauses the owning Argo Application when possible, swaps the original PVC identity, then resumes normal reconciliation."
          : restoreMode === "clone-workload"
            ? restoreSelectionError ||
              "Clone restore keeps supported Deployment and StatefulSet backups close to their original workload shape so validation stays safer and faster."
            : "PVC-only restore recreates detached Longhorn-backed claims without rehydrating the workload controller."}
      </div>

      <div className="mt-4 rounded-[24px] border border-rose-400/15 bg-rose-400/10 px-4 py-4 text-sm text-rose-50">
        Purge removes the selected backup sets from Longhorn and the backup target permanently. Use it to clear old recovery points once retention or manual cleanup makes them obsolete.
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
  );

  const activityPage = (
    <section className="panel rounded-[32px] p-5 sm:p-6" data-testid="activity-page-shell">
      <SectionHeading
        actions={
          <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-xs font-medium text-sky-100">
            Live queue · {pluralize(runningOperations, "active run")}
          </span>
        }
        description="Queued, running, and finished work all stay in one place so you can follow the exact timeline for each app and volume."
        eyebrow="Activity"
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
                    "rounded-[28px] border p-4 sm:p-5",
                    operation.status === "running"
                      ? "border-sky-400/20 bg-sky-400/8"
                      : "border-white/8 bg-slate-950/60",
                  )}
                  key={operation.id}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
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
                      <h3 className="mt-3 break-words text-lg font-semibold text-white">
                        {operation.summary}
                      </h3>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                        <span className="overflow-safe">Requested by {operation.requestedBy}</span>
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

                    <div className="rounded-[24px] border border-white/8 bg-slate-950/65 px-4 py-4 text-sm lg:w-56">
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
                      style={{
                        width: `${Math.max(progress, operation.status === "queued" ? 8 : 0)}%`,
                      }}
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
                              <div className="min-w-0">
                                <div className="break-words font-medium text-white">
                                  {item.displayName}
                                </div>
                                <div className="overflow-safe mt-1 text-sm text-slate-400">
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
                                    <div className="break-all font-medium text-white">
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
                                    <div className="overflow-safe mt-2 text-rose-100">
                                      {volume.message}
                                    </div>
                                  ) : null}
                                  {(volume.backupName ||
                                    volume.snapshotName ||
                                    volume.restoredClaimName) && (
                                    <div className="mt-3 space-y-1 text-slate-400">
                                      {volume.snapshotName ? (
                                        <div className="overflow-safe">Snapshot: {volume.snapshotName}</div>
                                      ) : null}
                                      {volume.backupName ? (
                                        <div className="overflow-safe">Backup: {volume.backupName}</div>
                                      ) : null}
                                      {volume.restoredClaimName ? (
                                        <div className="overflow-safe">
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
                                        className="flex flex-col gap-1 text-xs sm:flex-row sm:gap-3"
                                        key={`${item.id}-${log.timestamp}-${log.message}`}
                                      >
                                        <span className="shrink-0 text-slate-500 sm:w-32">
                                          {formatTimestamp(log.timestamp)}
                                        </span>
                                        <span
                                          className={
                                            log.level === "error"
                                              ? "overflow-safe text-rose-100"
                                              : "overflow-safe text-slate-300"
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
  );

  const cleanupPage = (
    <section className="panel rounded-[32px] p-5 sm:p-6">
      <SectionHeading
        actions={
          <div className="flex flex-wrap gap-2">
            {[
              {
                id: "all",
                label: `All (${uiState.unmanagedItems.length})`,
              },
              {
                id: "high",
                label: `High confidence (${highConfidenceUnmanaged.length})`,
              },
              {
                id: "review",
                label: `Needs review (${reviewUnmanaged.length})`,
              },
            ].map((filter) => (
              <button
                className={cn(
                  "rounded-full border px-3.5 py-2 text-xs transition",
                  unmanagedFilter === filter.id
                    ? "border-amber-400/30 bg-amber-400/12 text-amber-50"
                    : "border-white/10 bg-white/5 text-slate-300 hover:border-amber-400/20 hover:text-white",
                )}
                key={filter.id}
                onClick={() => setUnmanagedFilter(filter.id as "all" | "high" | "review")}
                type="button"
              >
                {filter.label}
              </button>
            ))}
            <button
              className="rounded-full border border-amber-400/25 bg-amber-400/12 px-3.5 py-2 text-xs font-medium text-amber-50 transition hover:border-amber-300/40 hover:bg-amber-400/18 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={selectedUnmanagedRefs.length === 0 || workingLabel === "cleanup"}
              onClick={() => void runUnmanagedCleanup(selectedUnmanagedRefs)}
              type="button"
            >
              {workingLabel === "cleanup"
                ? "Cleaning selected..."
                : `Clean selected (${selectedUnmanagedRefs.length})`}
            </button>
          </div>
        }
        description="Orbit shows only conservative orphan candidates here: non-Argo resources outside critical namespaces, with high-confidence restore/test leftovers prioritized first."
        eyebrow="Orphaned resources"
        title="Review and clean up leftovers"
      />

      <div className="mt-5 rounded-[24px] border border-amber-400/20 bg-amber-400/10 px-4 py-4 text-sm text-amber-50">
        <div className="font-medium">High-confidence cleanup only</div>
        <div className="mt-1 text-amber-100/80">
          Orbit only deletes resources that still appear in the current unmanaged snapshot as high-confidence restore/test artifacts. Review-only items stay read-only.
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Total flagged",
            value: uiState.unmanagedItems.length,
            detail: "After conservative safety filters",
          },
          {
            label: "High confidence",
            value: highConfidenceUnmanaged.length,
            detail: "Restore/test signals detected",
          },
          {
            label: "Needs review",
            value: reviewUnmanaged.length,
            detail: "No Argo owner found, confirm manually",
          },
          {
            label: "Selected",
            value: selectedUnmanagedRefs.length,
            detail: "Queued for the next cleanup run",
          },
        ].map((item) => (
          <div
            className="rounded-[24px] border border-white/8 bg-slate-950/55 px-4 py-4"
            key={item.label}
          >
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
              {item.label}
            </div>
            <div className="mt-2 text-3xl font-semibold text-white">{item.value}</div>
            <div className="mt-1 text-xs text-slate-400">{item.detail}</div>
          </div>
        ))}
      </div>

      <div className="mt-5">
        {visibleUnmanagedItems.length > 0 ? (
          <div className="space-y-4">
            {visibleUnmanagedItems.map((item) => (
              <UnmanagedInventoryCard
                cleanupBusy={workingLabel === "cleanup"}
                item={item}
                key={item.ref}
                onCleanup={
                  item.confidence === "high"
                    ? () => void runUnmanagedCleanup([item.ref])
                    : undefined
                }
                onToggleSelect={
                  item.confidence === "high"
                    ? () =>
                        toggleSelection(
                          selectedUnmanagedRefs,
                          setSelectedUnmanagedRefs,
                          item.ref,
                        )
                    : undefined
                }
                selected={selectedUnmanagedRefs.includes(item.ref)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            description={
              unmanagedFilter === "high"
                ? "Orbit did not detect any restore/test artifacts that passed the conservative unmanaged filters."
                : unmanagedFilter === "review"
                  ? "Orbit did not find any review-only resources outside Argo ownership in the allowed namespaces."
                  : "Orbit did not detect any orphaned resources that passed the conservative safety filters."
            }
            title={
              unmanagedFilter === "high"
                ? "No high-confidence orphaned resources detected"
                : unmanagedFilter === "review"
                  ? "No review-only items detected"
                  : "No orphaned resources detected"
            }
          />
        )}
      </div>
    </section>
  );

  const activePageItem =
    pageItems.find((item) => item.id === activePage) ?? pageItems[0];

  const pageContent =
    activePage === "home"
      ? homePage
      : activePage === "backup"
        ? backupPage
        : activePage === "restore"
          ? restorePage
          : activePage === "activity"
            ? activityPage
            : cleanupPage;

  return (
    <main className="min-h-screen px-3 pb-[calc(6.75rem+env(safe-area-inset-bottom))] pt-4 text-sm text-slate-100 sm:px-5 sm:pt-5 lg:px-8 lg:pt-8">
      <div className="mx-auto flex w-full max-w-[94rem] flex-col gap-6">
        <section className="panel panel-grid relative overflow-hidden rounded-[32px] p-5 sm:p-6 lg:p-8">
          <div className="absolute -right-16 top-0 hidden h-64 w-64 rounded-full bg-sky-400/10 blur-3xl xl:block" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-xs font-medium tracking-wide text-sky-100">
                <ShieldCheck className="h-4 w-4" />
                Behind oauth2-proxy, powered by Longhorn
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Orbit Backup Console
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                A cleaner backup and restore surface for daily operations: home summary first,
                focused pages second, and no giant checklist once the workflows already work.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-xs text-slate-200">
                <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5">
                  Auto-refresh every 5s
                </span>
                <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5">
                  {pluralize(overview?.protectedWorkloadCount ?? protectedApps.length, "protected workload")}
                </span>
                <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5">
                  {pluralize(uiState.backupSets.length, "backup set")}
                </span>
                <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5">
                  {pluralize(uiState.unmanagedItems.length, "orphan candidate")}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:items-end">
              <div className="rounded-[24px] border border-white/10 bg-slate-950/65 px-4 py-3 text-sm text-slate-300">
                <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                  Current page
                </div>
                <div className="mt-2 font-medium text-white">{activePageItem.label}</div>
                <div className="mt-1 max-w-xs text-xs text-slate-400">
                  {activePageItem.description}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-4 py-2 font-medium text-slate-100 transition hover:border-sky-400/40 hover:bg-sky-400/10 disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={isRefreshing}
                  onClick={() => {
                    void refresh();
                    if (activePage === "backup") {
                      void refreshPbs();
                      void refreshDestinations();
                    }
                  }}
                  type="button"
                >
                  <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                  {isRefreshing ? "Refreshing..." : "Refresh now"}
                </button>
                {uiState.dashboard?.user.email ? (
                  <div className="overflow-safe-chip inline-flex max-w-full rounded-full border border-white/10 bg-slate-950/70 px-4 py-2 text-xs text-slate-300">
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
            <div className="overflow-safe mt-1 text-sm opacity-90">{notice.description}</div>
          </div>
        ) : null}

        {uiState.error && hasConsoleData ? (
          <div className="rounded-[24px] border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-rose-50">
            <div className="font-medium">Live refresh needs attention</div>
            <div className="overflow-safe mt-1 text-sm opacity-90">{uiState.error}</div>
          </div>
        ) : null}

        {bootstrapping ? (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <SkeletonPanel className="rounded-[28px] p-5" key={index} />
              ))}
            </section>
            <SkeletonPanel />
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
          pageContent
        )}
      </div>

      {!bootstrapping && !fatalError ? (
        <BottomNav
          activePage={activePage}
          items={pageItems}
          onSelect={(page) => setActivePage(page)}
        />
      ) : null}
    </main>
  );
}
