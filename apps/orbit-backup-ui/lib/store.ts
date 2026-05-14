import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { OperationRecord, PersistedState, ScheduleDefinition } from "@/lib/types";

declare global {
  var __orbitBackupStoreWriteChain: Promise<void> | undefined;
}

function getStateFilePath() {
  return (
    process.env.ORBIT_BACKUP_STATE_FILE ||
    path.join(/* turbopackIgnore: true */ process.cwd(), "data", "state.json")
  );
}

function getDefaultState(): PersistedState {
  return {
    operations: [],
    schedules: [],
  };
}

async function ensureStateFile() {
  const stateFilePath = getStateFilePath();
  await mkdir(path.dirname(stateFilePath), { recursive: true });

  try {
    await readFile(stateFilePath, "utf8");
  } catch {
    await writeFile(
      stateFilePath,
      JSON.stringify(getDefaultState(), null, 2),
      "utf8",
    );
  }
}

export async function readState(): Promise<PersistedState> {
  await ensureStateFile();
  const raw = await readFile(getStateFilePath(), "utf8");
  return raw.trim() ? (JSON.parse(raw) as PersistedState) : getDefaultState();
}

async function writeState(state: PersistedState) {
  await writeFile(getStateFilePath(), JSON.stringify(state, null, 2), "utf8");
}

export async function mutateState<T>(
  mutator: (draft: PersistedState) => Promise<T> | T,
): Promise<T> {
  const currentChain = globalThis.__orbitBackupStoreWriteChain ?? Promise.resolve();

  const next = currentChain.then(async () => {
    const draft = structuredClone(await readState());
    const result = await mutator(draft);
    await writeState(draft);
    return result;
  });

  globalThis.__orbitBackupStoreWriteChain = next.then(
    () => undefined,
    () => undefined,
  );

  return next;
}

export async function listOperations() {
  const state = await readState();
  return [...state.operations].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

export async function getOperation(id: string) {
  const state = await readState();
  return state.operations.find((operation) => operation.id === id);
}

export async function upsertOperation(operation: OperationRecord) {
  await mutateState((draft) => {
    const index = draft.operations.findIndex((entry) => entry.id === operation.id);
    if (index === -1) {
      draft.operations.unshift(operation);
    } else {
      draft.operations[index] = operation;
    }

    draft.operations = draft.operations
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 75);
  });
}

export async function patchOperation(
  id: string,
  updater: (operation: OperationRecord) => void,
) {
  return mutateState((draft) => {
    const operation = draft.operations.find((entry) => entry.id === id);
    if (!operation) {
      throw new Error(`Operation ${id} no longer exists.`);
    }
    updater(operation);
    return structuredClone(operation);
  });
}

export async function listSchedules() {
  const state = await readState();
  return [...state.schedules].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export async function upsertSchedule(schedule: ScheduleDefinition) {
  await mutateState((draft) => {
    const index = draft.schedules.findIndex((entry) => entry.id === schedule.id);
    if (index === -1) {
      draft.schedules.push(schedule);
    } else {
      draft.schedules[index] = schedule;
    }
  });
}

export async function deleteSchedule(id: string) {
  await mutateState((draft) => {
    draft.schedules = draft.schedules.filter((schedule) => schedule.id !== id);
  });
}
