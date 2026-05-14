import { NextResponse } from "next/server";

import {
  getBackupDestinationState,
  saveBackupDestinationPreferences,
} from "@/lib/destinations";
import { badRequest, jsonError } from "@/lib/http";
import { ensureRuntimeStarted } from "@/lib/runtime";
import type { UpdateBackupDestinationRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureRuntimeStarted();
    return NextResponse.json(await getBackupDestinationState());
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    await ensureRuntimeStarted();
    const body = (await request.json()) as UpdateBackupDestinationRequest;

    if (typeof body.longhornEnabled !== "boolean") {
      return badRequest("longhornEnabled must be true or false.");
    }

    await saveBackupDestinationPreferences(body);
    return NextResponse.json(await getBackupDestinationState());
  } catch (error) {
    return jsonError(error);
  }
}
