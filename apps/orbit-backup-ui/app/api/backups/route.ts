import { NextResponse } from "next/server";

import { getBackupSets } from "@/lib/cluster";
import { badRequest, jsonError } from "@/lib/http";
import { purgeBackupSets } from "@/lib/operations";
import { ensureRuntimeStarted } from "@/lib/runtime";
import type { PurgeBackupSetsRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureRuntimeStarted();
    return NextResponse.json({
      backupSets: await getBackupSets(),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureRuntimeStarted();
    const body = (await request.json()) as PurgeBackupSetsRequest;

    if (!body.setIds?.length) {
      return badRequest("Select at least one backup set to purge.");
    }

    return NextResponse.json(await purgeBackupSets(body.setIds));
  } catch (error) {
    return jsonError(error);
  }
}
