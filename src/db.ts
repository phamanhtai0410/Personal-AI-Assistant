import { DatabaseSync } from "node:sqlite";

export type SessionRow = {
  session_key: string;
  agent_id: string | null;
  channel: string;
  thread_ts: string | null;
  model_id: string | null;
  updated_at: string;
};

export type OutboxRow = {
  id: number;
  session_key: string;
  payload_json: string;
  created_at: string;
};

export type JobRow = {
  id: string;
  cron: string;
  last_run_at: string | null;
  enabled: number;
};

export type DayTokenStats = {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export class PaiDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_key TEXT PRIMARY KEY,
        agent_id TEXT,
        channel TEXT NOT NULL,
        thread_ts TEXT,
        model_id TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS daily_runs (
        day TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day)
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        cron TEXT NOT NULL,
        last_run_at TEXT,
        enabled INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS run_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        agent_id TEXT,
        run_id TEXT,
        status TEXT,
        model_id TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        day TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    this.ensureColumn("sessions", "model_id", "TEXT");
    this.ensureColumn("run_log", "model_id", "TEXT");
    this.ensureColumn("run_log", "input_tokens", "INTEGER");
    this.ensureColumn("run_log", "output_tokens", "INTEGER");
    this.ensureColumn("run_log", "total_tokens", "INTEGER");
    this.ensureColumn("run_log", "day", "TEXT");
  }

  private ensureColumn(
    table: string,
    column: string,
    type: string,
  ): void {
    const cols = this.db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    if (cols.some((c) => c.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }

  getSetting(key: string): string | undefined {
    const row = this.db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  getSession(sessionKey: string): SessionRow | undefined {
    const row = this.db
      .prepare(
        `SELECT session_key, agent_id, channel, thread_ts, model_id, updated_at
         FROM sessions WHERE session_key = ?`,
      )
      .get(sessionKey) as SessionRow | undefined;
    return row;
  }

  upsertSession(input: {
    sessionKey: string;
    agentId: string | null;
    channel: string;
    threadTs: string | null;
    modelId?: string | null;
  }): void {
    const now = new Date().toISOString();
    const existing = this.getSession(input.sessionKey);
    const modelId =
      input.modelId !== undefined
        ? input.modelId
        : (existing?.model_id ?? null);

    this.db
      .prepare(
        `INSERT INTO sessions (session_key, agent_id, channel, thread_ts, model_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_key) DO UPDATE SET
           agent_id = excluded.agent_id,
           channel = excluded.channel,
           thread_ts = excluded.thread_ts,
           model_id = excluded.model_id,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.sessionKey,
        input.agentId,
        input.channel,
        input.threadTs,
        modelId,
        now,
      );
  }

  setSessionModel(sessionKey: string, modelId: string | null): void {
    const existing = this.getSession(sessionKey);
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO sessions (session_key, agent_id, channel, thread_ts, model_id, updated_at)
           VALUES (?, NULL, ?, NULL, ?, ?)`,
        )
        .run(sessionKey, "unknown", modelId, new Date().toISOString());
      return;
    }
    this.db
      .prepare(
        `UPDATE sessions SET model_id = ?, updated_at = ? WHERE session_key = ?`,
      )
      .run(modelId, new Date().toISOString(), sessionKey);
  }

  clearAgent(sessionKey: string): void {
    this.db
      .prepare(
        `UPDATE sessions SET agent_id = NULL, updated_at = ? WHERE session_key = ?`,
      )
      .run(new Date().toISOString(), sessionKey);
  }

  enqueueOutbox(sessionKey: string, payload: unknown): void {
    this.db
      .prepare(
        `INSERT INTO outbox (session_key, payload_json, created_at) VALUES (?, ?, ?)`,
      )
      .run(sessionKey, JSON.stringify(payload), new Date().toISOString());
  }

  dequeueOutbox(sessionKey: string): OutboxRow | undefined {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          `SELECT id, session_key, payload_json, created_at
           FROM outbox WHERE session_key = ? ORDER BY id ASC LIMIT 1`,
        )
        .get(sessionKey) as OutboxRow | undefined;
      if (!row) {
        this.db.exec("COMMIT");
        return undefined;
      }
      this.db.prepare(`DELETE FROM outbox WHERE id = ?`).run(row.id);
      this.db.exec("COMMIT");
      return row;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  getDailyRunCount(day: string): number {
    const row = this.db
      .prepare(`SELECT count FROM daily_runs WHERE day = ?`)
      .get(day) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  incrementDailyRun(day: string): number {
    this.db
      .prepare(
        `INSERT INTO daily_runs (day, count) VALUES (?, 1)
         ON CONFLICT(day) DO UPDATE SET count = count + 1`,
      )
      .run(day);
    return this.getDailyRunCount(day);
  }

  logRun(input: {
    sessionKey: string;
    agentId: string | null;
    runId: string | null;
    status: string;
    modelId?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    day?: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO run_log (
           session_key, agent_id, run_id, status, model_id,
           input_tokens, output_tokens, total_tokens, day, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sessionKey,
        input.agentId,
        input.runId,
        input.status,
        input.modelId ?? null,
        input.inputTokens ?? null,
        input.outputTokens ?? null,
        input.totalTokens ?? null,
        input.day ?? null,
        new Date().toISOString(),
      );
  }

  getDayTokenStats(day: string): DayTokenStats {
    const rows = this.db
      .prepare(
        `SELECT
           COUNT(*) AS runs,
           COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens,
           COALESCE(SUM(total_tokens), 0) AS total_tokens
         FROM run_log
         WHERE day = ?`,
      )
      .get(day) as {
      runs: number;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };

    return {
      runs: Number(rows.runs ?? 0),
      inputTokens: Number(rows.input_tokens ?? 0),
      outputTokens: Number(rows.output_tokens ?? 0),
      totalTokens: Number(rows.total_tokens ?? 0),
    };
  }

  upsertJob(id: string, cron: string, enabled: boolean): void {
    this.db
      .prepare(
        `INSERT INTO jobs (id, cron, enabled) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET cron = excluded.cron, enabled = excluded.enabled`,
      )
      .run(id, cron, enabled ? 1 : 0);
  }

  getJob(id: string): JobRow | undefined {
    return this.db
      .prepare(`SELECT id, cron, last_run_at, enabled FROM jobs WHERE id = ?`)
      .get(id) as JobRow | undefined;
  }

  markJobRun(id: string, at: string): void {
    this.db
      .prepare(`UPDATE jobs SET last_run_at = ? WHERE id = ?`)
      .run(at, id);
  }

  close(): void {
    this.db.close();
  }
}
