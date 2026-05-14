import { NextResponse } from "next/server";

import { badRequest, jsonError } from "@/lib/http";
import {
  createSchedule,
  listSchedules,
  removeSchedule,
  updateSchedule,
} from "@/lib/operations";
import { ensureRuntimeStarted } from "@/lib/runtime";
import {
  CreateScheduleRequest,
  DeleteScheduleRequest,
  UpdateScheduleRequest,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureRuntimeStarted();
    return NextResponse.json({
      schedules: await listSchedules(),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureRuntimeStarted();
    const body = (await request.json()) as CreateScheduleRequest;

    if (!body.name?.trim()) {
      return badRequest("A schedule name is required.");
    }

    if (!body.cron?.trim()) {
      return badRequest("A cron expression is required.");
    }

    if (!body.appRefs?.length) {
      return badRequest("Select at least one workload for the schedule.");
    }

    if (typeof body.retain !== "undefined" && (!Number.isInteger(body.retain) || body.retain < 1)) {
      return badRequest("Retention must be a positive whole number.");
    }

    const schedule = await createSchedule(body);
    return NextResponse.json({ schedule }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    await ensureRuntimeStarted();
    const body = (await request.json()) as UpdateScheduleRequest;

    if (!body.id) {
      return badRequest("Schedule id is required.");
    }

    if (typeof body.retain !== "undefined" && (!Number.isInteger(body.retain) || body.retain < 1)) {
      return badRequest("Retention must be a positive whole number.");
    }

    const schedule = await updateSchedule(body);
    return NextResponse.json({ schedule });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureRuntimeStarted();
    const body = (await request.json()) as DeleteScheduleRequest;
    if (!body.id) {
      return badRequest("Schedule id is required.");
    }

    await removeSchedule(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
