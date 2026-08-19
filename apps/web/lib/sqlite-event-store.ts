import type { EventStore, LoopEvent } from "@hulala/core";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

interface EventRow {
  event_id: string;
  loop_id: string;
  version: number;
  event_type: LoopEvent["type"];
  occurred_at: string;
  payload_json: string;
}

export class SQLiteEventStore implements EventStore {
  private readonly db: DatabaseSync;

  constructor(dataDirectory = process.env.LOOP_DATA_DIR ?? join(homedir(), ".hulala")) {
    mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(dataDirectory, "loop.db"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS loop_events (
        loop_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (loop_id, version)
      );
      CREATE INDEX IF NOT EXISTS loop_events_time_idx
      ON loop_events (occurred_at DESC);
    `);
  }

  async listLoopIds(): Promise<string[]> {
    const rows = this.db
      .prepare("SELECT loop_id FROM loop_events GROUP BY loop_id ORDER BY MAX(occurred_at) DESC")
      .all() as unknown as Array<{ loop_id: string }>;
    return rows.map((row) => row.loop_id);
  }

  async read(loopId: string): Promise<LoopEvent[]> {
    const rows = this.db
      .prepare(`
        SELECT event_id, loop_id, version, event_type, occurred_at, payload_json
        FROM loop_events
        WHERE loop_id = ?
        ORDER BY version ASC
      `)
      .all(loopId) as unknown as EventRow[];

    return rows.map((row) => ({
      id: row.event_id,
      loopId: row.loop_id,
      version: row.version,
      type: row.event_type,
      occurredAt: row.occurred_at,
      payload: JSON.parse(row.payload_json) as unknown,
    }));
  }

  async append(loopId: string, expectedVersion: number, events: LoopEvent[]): Promise<void> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.db
        .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM loop_events WHERE loop_id = ?")
        .get(loopId) as unknown as { version: number };
      if (current.version !== expectedVersion) {
        throw new Error(`Loop changed while you were editing it. Expected version ${expectedVersion}, found ${current.version}.`);
      }

      const insert = this.db.prepare(`
        INSERT INTO loop_events (loop_id, version, event_id, event_type, occurred_at, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const event of events) {
        insert.run(
          event.loopId,
          event.version,
          event.id,
          event.type,
          event.occurredAt,
          JSON.stringify(event.payload),
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
