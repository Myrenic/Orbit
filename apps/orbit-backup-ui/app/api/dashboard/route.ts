import { NextResponse } from "next/server";

import { getUserFromHeaders } from "@/lib/auth";
import { getClusterSnapshot } from "@/lib/cluster";
import { jsonError } from "@/lib/http";
import { listSchedules } from "@/lib/operations";
import { ensureRuntimeStarted } from "@/lib/runtime";
import { listOperations } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await ensureRuntimeStarted();

    const [snapshot, operations, schedules] = await Promise.all([
      getClusterSnapshot(),
      listOperations(),
      listSchedules(),
    ]);

    const runningOperations = operations.filter(
      (operation) => operation.status === "queued" || operation.status === "running",
    ).length;

    return NextResponse.json({
      user: getUserFromHeaders(request.headers),
      overview: {
        ...snapshot.overview,
        runningOperations,
      },
      recentOperations: operations.slice(0, 8),
      schedules,
      targets: snapshot.targets,
    });
  } catch (error) {
    return jsonError(error);
  }
}
