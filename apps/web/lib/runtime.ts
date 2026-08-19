import { LoopService } from "@hulala/core";
import { DshAgentDriver } from "./dsh-agent-driver";
import { SQLiteEventStore } from "./sqlite-event-store";

interface LoopRuntime {
  service: LoopService;
  agent: DshAgentDriver;
}

const globalRuntime = globalThis as typeof globalThis & { __loopRuntime?: LoopRuntime };

export function getRuntime(): LoopRuntime {
  if (!globalRuntime.__loopRuntime) {
    const agent = new DshAgentDriver();
    globalRuntime.__loopRuntime = {
      agent,
      service: new LoopService(new SQLiteEventStore(), agent),
    };
  }
  return globalRuntime.__loopRuntime;
}
