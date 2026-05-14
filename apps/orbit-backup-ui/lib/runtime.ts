import {
  migratePersistedSchedules,
  processQueuedOperations,
  reconcileManagedSchedules,
  reconcilePersistedOperations,
} from "@/lib/operations";

declare global {
  var __orbitBackupRuntime:
    | { started: boolean; draining: boolean; scheduleInterval?: NodeJS.Timeout }
    | undefined;
}

async function drainQueue() {
  const runtime = globalThis.__orbitBackupRuntime;
  if (!runtime || runtime.draining) {
    return;
  }

  runtime.draining = true;
  try {
    while (await processQueuedOperations()) {
      // keep draining until the queue is empty
    }
  } finally {
    runtime.draining = false;
  }
}

async function reconcileSchedules() {
  await reconcileManagedSchedules();
}

export async function ensureRuntimeStarted() {
  if (!globalThis.__orbitBackupRuntime) {
    globalThis.__orbitBackupRuntime = {
      started: false,
      draining: false,
    };
  }

  const runtime = globalThis.__orbitBackupRuntime;
  if (runtime.started) {
    return;
  }

  runtime.started = true;
  try {
    await migratePersistedSchedules();
    await reconcilePersistedOperations();
    await reconcileSchedules();

    runtime.scheduleInterval = setInterval(() => {
      void reconcileSchedules();
      void drainQueue();
    }, 30_000);

    await drainQueue();
  } catch (error) {
    runtime.started = false;
    if (runtime.scheduleInterval) {
      clearInterval(runtime.scheduleInterval);
      runtime.scheduleInterval = undefined;
    }
    throw error;
  }
}

export function pokeRuntime() {
  void ensureRuntimeStarted()
    .then(() => drainQueue())
    .catch((error) => {
      console.error(error);
    });
}
