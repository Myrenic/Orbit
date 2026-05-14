import { NextResponse } from "next/server";

import { badRequest, jsonError } from "@/lib/http";
import {
  archiveBackupCatalogToPbs,
  getPbsStatus,
  prunePbsArchives,
  updatePbsConfig,
} from "@/lib/pbs";
import { ensureRuntimeStarted } from "@/lib/runtime";
import type { PbsActionRequest, UpdatePbsConfigRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureRuntimeStarted();
    return NextResponse.json({
      pbs: await getPbsStatus(),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    await ensureRuntimeStarted();
    const body = (await request.json()) as UpdatePbsConfigRequest;

    return NextResponse.json({
      pbs: await updatePbsConfig(body),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureRuntimeStarted();
    const body = (await request.json()) as PbsActionRequest;

    if (!body.action) {
      return badRequest("PBS action is required.");
    }

    if (body.action === "test") {
      return NextResponse.json({
        pbs: await getPbsStatus(),
      });
    }

    if (body.action === "archive") {
      return NextResponse.json({
        pbs: await archiveBackupCatalogToPbs(),
      });
    }

    if (body.action === "prune") {
      return NextResponse.json({
        pbs: await prunePbsArchives(),
      });
    }

    return badRequest("Unsupported PBS action.");
  } catch (error) {
    return jsonError(error);
  }
}
