import { NextResponse } from "next/server";

import { jsonError } from "@/lib/http";
import { ensureRuntimeStarted } from "@/lib/runtime";
import { getOperation } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureRuntimeStarted();
    const { id } = await context.params;
    const operation = await getOperation(id);

    if (!operation) {
      return NextResponse.json({ error: "Operation not found." }, { status: 404 });
    }

    return NextResponse.json({ operation });
  } catch (error) {
    return jsonError(error);
  }
}
