import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const data = await getRuntime().service.export(id);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${id}.loop.json"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

