export type SessionRef = {
  channel: string;
  threadTs: string | null;
};

/** Map a Slack DM or thread to a stable session key. */
export function buildSessionKey(ref: SessionRef): string {
  if (ref.threadTs) {
    return `slack:${ref.channel}:thread:${ref.threadTs}`;
  }
  return `slack:${ref.channel}`;
}

export function todayInTimezone(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function canStartRun(
  currentCount: number,
  dailyCap: number,
): { ok: true } | { ok: false; reason: string } {
  if (currentCount >= dailyCap) {
    return {
      ok: false,
      reason: `Daily run cap reached (${currentCount}/${dailyCap}). Try again tomorrow or raise PAI_DAILY_RUN_CAP.`,
    };
  }
  return { ok: true };
}
