import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    return NextResponse.json(await getRuntime().service.get(id));
  } catch (error) {
    return errorResponse(error);
  }
}

