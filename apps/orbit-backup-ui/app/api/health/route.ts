import { NextResponse } from "next/server";

import { ensureRuntimeStarted } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureRuntimeStarted();
  return NextResponse.json({
    ok: true,
    service: "orbit-backup-ui",
  });
}
