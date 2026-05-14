import { NextResponse } from "next/server";

import { getBackupTargets } from "@/lib/cluster";
import { badRequest, jsonError } from "@/lib/http";
import { ensureRuntimeStarted } from "@/lib/runtime";
import { syncBackupTarget } from "@/lib/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureRuntimeStarted();
    return NextResponse.json({
      targets: await getBackupTargets(),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    await ensureRuntimeStarted();
    const body = (await request.json()) as {
      backupTargetURL?: string;
      credentialSecret?: string;
      pollInterval?: string;
    };

    if (!body.backupTargetURL) {
      return badRequest("backupTargetURL is required.");
    }

    await syncBackupTarget({
      backupTargetURL: body.backupTargetURL,
      credentialSecret: body.credentialSecret || "",
      pollInterval: body.pollInterval || "300s",
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
