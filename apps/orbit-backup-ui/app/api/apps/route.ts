import { NextResponse } from "next/server";

import { getClusterSnapshot } from "@/lib/cluster";
import { jsonError } from "@/lib/http";
import { ensureRuntimeStarted } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureRuntimeStarted();
    const snapshot = await getClusterSnapshot();

    return NextResponse.json({
      apps: snapshot.apps,
      unmanagedItems: snapshot.unmanagedItems,
    });
  } catch (error) {
    return jsonError(error);
  }
}
