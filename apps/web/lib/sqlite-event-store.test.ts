import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { LoopEvent } from "@hulala/core";
import { SQLiteEventStore } from "./sqlite-event-store";

test("persists ordered events and enforces optimistic concurrency", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hulala-store-"));
  const event: LoopEvent = {
    id: "evt_test",
    loopId: "loop_test",
    version: 1,
    type: "loop.created",
    occurredAt: "2026-08-13T00:00:00.000Z",
    payload: { name: "test" },
  };

  const first = new SQLiteEventStore(directory);
  try {
    await first.append("loop_test", 0, [event]);
    assert.deepEqual(await first.listLoopIds(), ["loop_test"]);
    assert.deepEqual(await first.read("loop_test"), [event]);
    await assert.rejects(
      first.append("loop_test", 0, [{ ...event, id: "evt_conflict", version: 2 }]),
      /Expected version 0, found 1/,
    );
  } finally {
    first.close();
  }

  const reopened = new SQLiteEventStore(directory);
  try {
    assert.deepEqual(await reopened.read("loop_test"), [event]);
  } finally {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
