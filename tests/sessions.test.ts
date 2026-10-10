import { describe, expect, it } from "vitest";
import {
  buildSessionKey,
  canStartRun,
  todayInTimezone,
} from "../src/sessions.js";

describe("buildSessionKey", () => {
  it("maps a DM channel", () => {
    expect(buildSessionKey({ channel: "D123", threadTs: null })).toBe(
      "slack:D123",
    );
  });

  it("maps a thread", () => {
    expect(
      buildSessionKey({ channel: "D123", threadTs: "1710000.000100" }),
    ).toBe("slack:D123:thread:1710000.000100");
  });
});

describe("canStartRun", () => {
  it("allows under cap", () => {
    expect(canStartRun(0, 40)).toEqual({ ok: true });
    expect(canStartRun(39, 40)).toEqual({ ok: true });
  });

  it("blocks at cap", () => {
    const result = canStartRun(40, 40);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Daily run cap/);
    }
  });
});

describe("todayInTimezone", () => {
  it("formats YYYY-MM-DD in the given zone", () => {
    const day = todayInTimezone(
      "UTC",
      new Date("2026-03-15T01:00:00.000Z"),
    );
    expect(day).toBe("2026-03-15");
  });
});
