import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import tls from "node:tls";

import { getClusterSnapshot } from "@/lib/cluster";
import { getPersistedPbsState, listOperations, readState, updatePersistedPbsState } from "@/lib/store";
import type {
  OperationRecord,
  PbsConfig,
  PbsSnapshotSummary,
  PbsStatusSummary,
  PersistedPbsState,
  UpdatePbsConfigRequest,
} from "@/lib/types";

const execFileAsync = promisify(execFile);
const DEFAULT_PBS_BACKUP_ID = "orbit-backup-ui";
const DEFAULT_KEEP_LAST = 7;
const PBS_ARCHIVE_NAME = "orbit-backup-ui-state.pxar";

function now() {
  return new Date().toISOString();
}

function getPositiveInteger(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

function normalizeServer(value: string) {
  return value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function normalizeBackupId(value?: string) {
  const normalized = (value || DEFAULT_PBS_BACKUP_ID)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  return normalized || DEFAULT_PBS_BACKUP_ID;
}

function getSnapshotGroup(config: PbsConfig) {
  return `host/${config.backupId}`;
}

function buildRepository(config: PbsConfig) {
  return `${config.username}@${config.server}:${config.datastore}`;
}

function getStatusSummary(
  persisted: PersistedPbsState | undefined,
  config: PbsConfig | undefined,
  overrides: Partial<PbsStatusSummary> = {},
): PbsStatusSummary {
  return {
    configured: Boolean(config),
    enabled: config?.enabled ?? false,
    reachable: false,
    server: config?.server,
    datastore: config?.datastore,
    username: config?.username,
    backupId: config?.backupId,
    fingerprint: config?.fingerprint,
    keepLast: config?.keepLast,
    archiveOnBackup: config?.archiveOnBackup ?? true,
    passwordConfigured: Boolean(config?.password),
    lastValidatedAt: persisted?.lastValidatedAt,
    lastArchiveAt: persisted?.lastArchiveAt,
    lastArchiveError: persisted?.lastArchiveError,
    snapshots: [],
    ...overrides,
  };
}

async function getServerFingerprint(server: string) {
  const target = server.startsWith("http://") || server.startsWith("https://")
    ? new URL(server)
    : new URL(`https://${server}`);

  const host = target.hostname;
  const port = target.port ? Number(target.port) : 8007;

  return new Promise<string>((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port,
        rejectUnauthorized: false,
      },
      () => {
        const certificate = socket.getPeerCertificate();
        socket.end();

        if (!certificate?.fingerprint256) {
          reject(new Error("PBS did not present a fingerprint."));
          return;
        }

        resolve(String(certificate.fingerprint256).toLowerCase());
      },
    );

    socket.on("error", (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

async function runPbsClient(config: PbsConfig, args: string[]) {
  if (!config.password) {
    throw new Error("The PBS password is not configured.");
  }

  const fingerprint = config.fingerprint || (await getServerFingerprint(config.server));
  const { stdout } = await execFileAsync("proxmox-backup-client", args, {
    env: {
      ...process.env,
      PBS_PASSWORD: config.password,
      PBS_FINGERPRINT: fingerprint,
    },
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (!config.fingerprint && fingerprint) {
    await updatePersistedPbsState((current) => ({
      ...current,
      config: current?.config
        ? {
            ...current.config,
            fingerprint,
            updatedAt: now(),
          }
        : config,
    }));
  }

  return {
    stdout,
    fingerprint,
  };
}

async function requirePbsConfig() {
  const persisted = await getPersistedPbsState();
  const config = persisted?.config;

  if (!config) {
    throw new Error("PBS is not configured.");
  }

  if (!config.server || !config.datastore || !config.username) {
    throw new Error("PBS configuration is incomplete.");
  }

  if (!config.password) {
    throw new Error("PBS configuration is missing a password.");
  }

  return {
    persisted,
    config,
  };
}

function sanitizeState(state: Awaited<ReturnType<typeof readState>>) {
  if (!state.pbs?.config?.password) {
    return state;
  }

  return {
    ...state,
    pbs: {
      ...state.pbs,
      config: {
        ...state.pbs.config,
        password: undefined,
      },
    },
  };
}

async function buildArchiveBundle(tempPath: string, operation?: OperationRecord) {
  const [snapshot, operations, state] = await Promise.all([
    getClusterSnapshot(true),
    listOperations(),
    readState(),
  ]);

  const relatedBackupSets = operation?.type === "backup"
    ? snapshot.backupSets.filter(
        (backupSet) =>
          backupSet.id.startsWith(`${operation.id}:`) ||
          operation.items.some((item) => item.appRef && backupSet.currentAppRef === item.appRef),
      )
    : snapshot.backupSets;

  const payload = {
    generatedAt: now(),
    source: operation
      ? {
          operationId: operation.id,
          operationType: operation.type,
          requestedBy: operation.requestedBy,
          createdAt: operation.createdAt,
          finishedAt: operation.finishedAt,
        }
      : {
          operationType: "manual",
        },
    overview: snapshot.overview,
    targets: snapshot.targets,
    apps: snapshot.apps,
    backupSets: relatedBackupSets,
    operations: operations.slice(0, 25),
    state: sanitizeState(state),
  };

  await writeFile(
    path.join(tempPath, "orbit-backup-catalog.json"),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(tempPath, "README.txt"),
    [
      "Orbit PBS archive mirror",
      "",
      "This archive stores Orbit backup catalog metadata, operation history, schedules,",
      "and Longhorn backup inventory so the control-plane state can be recovered off-cluster.",
      "It does not replace the Longhorn backup target for volume data blocks.",
      "",
      `Generated at: ${payload.generatedAt}`,
    ].join("\n"),
    "utf8",
  );

  if (operation) {
    await writeFile(
      path.join(tempPath, "source-operation.json"),
      JSON.stringify(operation, null, 2),
      "utf8",
    );
  }
}

async function listGroupSnapshots(config: PbsConfig) {
  const { stdout, fingerprint } = await runPbsClient(config, [
    "snapshot",
    "list",
    getSnapshotGroup(config),
    "--repository",
    buildRepository(config),
    "--output-format",
    "json",
  ]);
  const parsed = JSON.parse(stdout) as Array<{
    "backup-id"?: string;
    "backup-time"?: number;
    protected?: boolean;
  }>;

  const snapshots: PbsSnapshotSummary[] = parsed
    .map((entry) => ({
      id: `${getSnapshotGroup(config)}/${new Date(
        (entry["backup-time"] ?? 0) * 1000,
      ).toISOString()}`,
      backupTime: new Date((entry["backup-time"] ?? 0) * 1000).toISOString(),
      protected: Boolean(entry.protected),
    }))
    .sort((left, right) => right.backupTime.localeCompare(left.backupTime));

  return {
    snapshots,
    fingerprint,
  };
}

async function persistValidationResult(
  updater: (current: PersistedPbsState | undefined) => PersistedPbsState | undefined,
) {
  await updatePersistedPbsState(updater);
}

export async function getPbsStatus() {
  const persisted = await getPersistedPbsState();
  const config = persisted?.config;

  if (!config) {
    return getStatusSummary(persisted, undefined);
  }

  try {
    const { snapshots, fingerprint } = await listGroupSnapshots(config);
    const validatedAt = now();
    await persistValidationResult((current) => ({
      ...current,
      config: current?.config
        ? {
            ...current.config,
            fingerprint: current.config.fingerprint || fingerprint,
            updatedAt: current.config.updatedAt,
          }
        : config,
      lastValidatedAt: validatedAt,
    }));

    return getStatusSummary(
      {
        ...persisted,
        lastValidatedAt: validatedAt,
      },
      {
        ...config,
        fingerprint: config.fingerprint || fingerprint,
      },
      {
        reachable: true,
        snapshots,
      },
    );
  } catch (error) {
    const validatedAt = now();
    await persistValidationResult((current) => ({
      ...current,
      lastValidatedAt: validatedAt,
    }));

    return getStatusSummary(
      {
        ...persisted,
        lastValidatedAt: validatedAt,
      },
      config,
      {
        reachable: false,
        error: error instanceof Error ? error.message : "PBS validation failed.",
      },
    );
  }
}

export async function updatePbsConfig(input: UpdatePbsConfigRequest) {
  const persisted = await getPersistedPbsState();
  const current = persisted?.config;
  const normalizedServer = normalizeServer(input.server || current?.server || "");
  const normalizedConfig: PbsConfig = {
    enabled: Boolean(input.enabled),
    server: normalizedServer,
    datastore: (input.datastore || current?.datastore || "").trim(),
    username: (input.username || current?.username || "").trim(),
    password: input.password?.trim() ? input.password : current?.password,
    fingerprint: (input.fingerprint || current?.fingerprint || "").trim() || undefined,
    backupId: normalizeBackupId(input.backupId || current?.backupId),
    keepLast: getPositiveInteger(input.keepLast, current?.keepLast ?? DEFAULT_KEEP_LAST),
    archiveOnBackup: input.archiveOnBackup ?? current?.archiveOnBackup ?? true,
    updatedAt: now(),
  };

  if (!normalizedConfig.server) {
    throw new Error("PBS server is required.");
  }

  if (!normalizedConfig.datastore) {
    throw new Error("PBS datastore is required.");
  }

  if (!normalizedConfig.username) {
    throw new Error("PBS username is required.");
  }

  if (!normalizedConfig.password) {
    throw new Error("PBS password is required.");
  }

  if (!normalizedConfig.fingerprint) {
    normalizedConfig.fingerprint = await getServerFingerprint(normalizedConfig.server);
  }

  await updatePersistedPbsState((currentState) => ({
    ...currentState,
    config: normalizedConfig,
  }));

  return getPbsStatus();
}

export async function prunePbsArchives() {
  const { config } = await requirePbsConfig();
  await runPbsClient(config, [
    "prune",
    getSnapshotGroup(config),
    "--repository",
    buildRepository(config),
    "--keep-last",
    String(config.keepLast),
    "--output-format",
    "json",
  ]);

  return getPbsStatus();
}

export async function archiveBackupCatalogToPbs(operation?: OperationRecord) {
  const { config } = await requirePbsConfig();
  if (!config.enabled) {
    return getPbsStatus();
  }

  const tempPath = await mkdtemp(path.join(tmpdir(), "orbit-pbs-"));

  try {
    await buildArchiveBundle(tempPath, operation);
    await runPbsClient(config, [
      "backup",
      `${PBS_ARCHIVE_NAME}:${tempPath}`,
      "--repository",
      buildRepository(config),
      "--backup-id",
      config.backupId,
      "--backup-type",
      "host",
      "--crypt-mode",
      "none",
    ]);

    if (config.keepLast > 0) {
      await runPbsClient(config, [
        "prune",
        getSnapshotGroup(config),
        "--repository",
        buildRepository(config),
        "--keep-last",
        String(config.keepLast),
        "--output-format",
        "json",
      ]);
    }

    await updatePersistedPbsState((current) => ({
      ...current,
      lastArchiveAt: now(),
      lastArchiveError: undefined,
    }));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PBS archive upload failed.";
    await updatePersistedPbsState((current) => ({
      ...current,
      lastArchiveError: message,
    }));
    throw error;
  } finally {
    await rm(tempPath, { recursive: true, force: true });
  }

  return getPbsStatus();
}

export async function archiveBackupCatalogToPbsIfEnabled(operation?: OperationRecord) {
  const persisted = await getPersistedPbsState();
  const config = persisted?.config;

  if (!config?.enabled || !config.archiveOnBackup) {
    return undefined;
  }

  try {
    return await archiveBackupCatalogToPbs(operation);
  } catch (error) {
    console.error(error);
    return undefined;
  }
}
