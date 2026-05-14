import { NextResponse } from "next/server";

export function jsonError(error: unknown, status = 500) {
  const message =
    error instanceof Error ? error.message : "Unexpected server error";
  console.error(error);
  return NextResponse.json({ error: message }, { status });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
