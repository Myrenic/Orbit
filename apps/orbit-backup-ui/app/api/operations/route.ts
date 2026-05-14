import { NextResponse } from "next/server";

import { getRequestedBy } from "@/lib/auth";
import { getClusterSnapshot } from "@/lib/cluster";
import { badRequest, jsonError } from "@/lib/http";
import { createOperation } from "@/lib/operations";
import {
  getCloneRestoreBatchValidationError,
  getRestoreTargetNamespaceValidationError,
  isRestoreMode,
  normalizeRestoreTargetNamespace,
} from "@/lib/restore";
import { ensureRuntimeStarted, pokeRuntime } from "@/lib/runtime";
import { listOperations } from "@/lib/store";
import { CreateOperationRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureRuntimeStarted();
    return NextResponse.json({
      operations: await listOperations(),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureRuntimeStarted();
    const body = (await request.json()) as CreateOperationRequest;

    if (body.type === "backup") {
      if (!body.appRefs?.length) {
        return badRequest("Select at least one workload to back up.");
      }
    } else {
      if (!isRestoreMode(body.restoreMode)) {
        return badRequest("Select a supported restore mode.");
      }

      if (!body.backupSetIds?.length) {
        return badRequest("Select at least one backup set to restore.");
      }

      const targetNamespaceError = getRestoreTargetNamespaceValidationError(
        body.targetNamespace,
      );
      if (targetNamespaceError) {
        return badRequest(targetNamespaceError);
      }

      const snapshot = await getClusterSnapshot();
      const requestedBackupSets = body.backupSetIds
        .map((backupSetId) =>
          snapshot.backupSets.find((backupSet) => backupSet.id === backupSetId),
        )
        .filter(
          (backupSet): backupSet is (typeof snapshot.backupSets)[number] => Boolean(backupSet),
        );

      if (requestedBackupSets.length !== body.backupSetIds.length) {
        return badRequest(
          "One or more selected backup sets are no longer available. Refresh and try again.",
        );
      }

      if (body.restoreMode === "clone-workload") {
        const cloneRestoreError =
          getCloneRestoreBatchValidationError(requestedBackupSets);
        if (cloneRestoreError) {
          return badRequest(cloneRestoreError);
        }
      }
    }

    const normalizedBody =
      body.type === "restore"
        ? {
            ...body,
            targetNamespace: normalizeRestoreTargetNamespace(body.targetNamespace),
          }
        : body;

    const operation = await createOperation(normalizedBody, getRequestedBy(request.headers));
    pokeRuntime();
    return NextResponse.json({ operation }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
