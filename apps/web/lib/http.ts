import { NextResponse } from "next/server";

export function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "Unexpected local error.";
  const status = /not found/i.test(message) ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}

