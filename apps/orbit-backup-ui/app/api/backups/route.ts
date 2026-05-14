import { NextResponse } from "next/server";

import { getBackupSets } from "@/lib/cluster";
import { jsonError } from "@/lib/http";
import { ensureRuntimeStarted } from "@/lib/runtime";

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
