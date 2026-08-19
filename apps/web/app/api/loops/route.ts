import type { CreateLoopInput } from "@hulala/core";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await getRuntime().service.list());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const input = (await request.json()) as CreateLoopInput;
    return NextResponse.json(await getRuntime().service.create(input), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

