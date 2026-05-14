import { NextResponse } from "next/server";

import { getInventory } from "@/lib/cluster";
import { jsonError } from "@/lib/http";
import { ensureRuntimeStarted } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureRuntimeStarted();
    return NextResponse.json({
      apps: await getInventory(),
    });
  } catch (error) {
    return jsonError(error);
  }
}
