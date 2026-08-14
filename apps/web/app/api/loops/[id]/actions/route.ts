import type { HumanDecision, HumanPrior, Observation, Revision } from "@loopwithai/core";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LoopAction =
  | { type: "record_prior"; payload: HumanPrior }
  | { type: "request_advice" }
  | { type: "record_decision"; payload: HumanDecision }
  | { type: "record_observation"; payload: Observation }
  | { type: "complete_review"; payload: Revision };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const action = (await request.json()) as LoopAction;
    const service = getRuntime().service;

    switch (action.type) {
      case "record_prior":
        return NextResponse.json(await service.recordPrior(id, action.payload));
      case "request_advice":
        return NextResponse.json(await service.requestAdvice(id));
      case "record_decision":
        return NextResponse.json(await service.recordDecision(id, action.payload));
      case "record_observation":
        return NextResponse.json(await service.recordObservation(id, action.payload));
      case "complete_review":
        return NextResponse.json(await service.completeReview(id, action.payload));
      default:
        return NextResponse.json({ error: "Unsupported Loop action." }, { status: 400 });
    }
  } catch (error) {
    return errorResponse(error);
  }
}

