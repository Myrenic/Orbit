import { NextResponse } from "next/server";

import { cleanupUnmanagedInventory } from "@/lib/cluster";
import { badRequest, jsonError } from "@/lib/http";
import { ensureRuntimeStarted } from "@/lib/runtime";
import { CleanupUnmanagedRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await ensureRuntimeStarted();
    const body = (await request.json()) as CleanupUnmanagedRequest;

    if (!Array.isArray(body.refs) || body.refs.length === 0) {
      return badRequest("Select at least one high-confidence unmanaged item to clean up.");
    }

    const result = await cleanupUnmanagedInventory(body.refs);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
