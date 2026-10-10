import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PaiDatabase } from "../src/db.js";

describe("PaiDatabase", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("persists sessions and daily runs", () => {
    const dir = mkdtempSync(join(tmpdir(), "pai-db-"));
    dirs.push(dir);
    const db = new PaiDatabase(join(dir, "t.db"));

    db.upsertSession({
      sessionKey: "slack:D1",
      agentId: "agent-1",
      channel: "D1",
      threadTs: null,
    });
    expect(db.getSession("slack:D1")?.agent_id).toBe("agent-1");

    expect(db.incrementDailyRun("2026-03-15")).toBe(1);
    expect(db.incrementDailyRun("2026-03-15")).toBe(2);

    db.enqueueOutbox("slack:D1", { text: "hi" });
    const row = db.dequeueOutbox("slack:D1");
    expect(JSON.parse(row!.payload_json)).toEqual({ text: "hi" });
    expect(db.dequeueOutbox("slack:D1")).toBeUndefined();

    db.close();
  });
});
