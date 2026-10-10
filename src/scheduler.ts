import type { AppConfig } from "./config.js";
import type { PaiDatabase } from "./db.js";
import type { CursorRuntime } from "./cursor-runtime.js";
import { buildBriefingPrompt } from "./vault.js";
import { buildSessionKey, todayInTimezone, canStartRun } from "./sessions.js";
import { resolveModelId } from "./models.js";

export type BriefingDelivery = {
  post: (channel: string, text: string) => Promise<void>;
};

/**
 * Minimal cron matcher for "m h * * *" expressions (UTC or host-local via Intl).
 * Good enough for a single daily briefing job.
 */
export function cronMatchesMinute(
  cron: string,
  date: Date,
  timezone: string,
): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minutePart, hourPart] = parts;
  if (minutePart == null || hourPart == null) return false;

  const partsLocal = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);

  const minute = Number(
    partsLocal.find((p) => p.type === "minute")?.value ?? "-1",
  );
  const hour = Number(partsLocal.find((p) => p.type === "hour")?.value ?? "-1");

  const minuteOk = minutePart === "*" || Number(minutePart) === minute;
  const hourOk = hourPart === "*" || Number(hourPart) === hour;
  return minuteOk && hourOk;
}

export function startBriefingScheduler(input: {
  config: AppConfig;
  db: PaiDatabase;
  runtime: CursorRuntime;
  delivery: BriefingDelivery;
}): () => void {
  const { config, db, runtime, delivery } = input;
  db.upsertJob("morning-briefing", config.briefingCron, config.briefingEnabled);

  if (!config.briefingEnabled) {
    console.log("[scheduler] briefing disabled");
    return () => undefined;
  }

  console.log(
    `[scheduler] briefing cron="${config.briefingCron}" tz=${config.timezone}`,
  );

  const timer = setInterval(() => {
    void tick();
  }, 30_000);

  async function tick(): Promise<void> {
    const now = new Date();
    if (!cronMatchesMinute(config.briefingCron, now, config.timezone)) return;

    const job = db.getJob("morning-briefing");
    if (!job || !job.enabled) return;

    const dayMinute = `${todayInTimezone(config.timezone, now)}T${now
      .toLocaleTimeString("en-GB", {
        timeZone: config.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })}`;

    if (job.last_run_at?.startsWith(dayMinute.slice(0, 16))) return;
    // Deduplicate by date+hour+minute string stored on last_run_at
    if (job.last_run_at === dayMinute) return;

    const day = todayInTimezone(config.timezone, now);
    const count = db.getDailyRunCount(day);
    const gate = canStartRun(count, config.dailyRunCap);
    if (!gate.ok) {
      console.warn(`[scheduler] skip briefing: ${gate.reason}`);
      return;
    }

    const sessionKey = buildSessionKey({
      channel: config.briefingChannel ?? `dm:${config.slackAllowedUserId}`,
      threadTs: null,
    });

    db.markJobRun("morning-briefing", dayMinute);
    db.incrementDailyRun(day);

    try {
      const session = db.getSession(sessionKey);
      const model = resolveModelId(db, config, sessionKey);
      const outcome = await runtime.send({
        sessionKey,
        agentId: session?.agent_id ?? null,
        modelId: model.modelId,
        prompt: buildBriefingPrompt(),
      });
      db.upsertSession({
        sessionKey,
        agentId: outcome.agentId,
        channel: config.briefingChannel ?? sessionKey,
        threadTs: null,
        modelId: outcome.modelId,
      });
      db.logRun({
        sessionKey,
        agentId: outcome.agentId,
        runId: outcome.runId,
        status: outcome.status,
        modelId: outcome.modelId,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        totalTokens: outcome.totalTokens,
        day,
      });

      const target = config.briefingChannel;
      if (!target) {
        console.log(
          "[scheduler] briefing complete; set PAI_BRIEFING_CHANNEL to a Slack DM channel id for delivery",
        );
        console.log(outcome.resultText.slice(0, 500));
        return;
      }
      await delivery.post(target, `*Morning briefing*\n${outcome.resultText}`);
    } catch (err) {
      console.error("[scheduler] briefing failed:", err);
    }
  }

  return () => clearInterval(timer);
}
