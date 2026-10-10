import { describe, expect, it } from "vitest";
import { cronMatchesMinute } from "../src/scheduler.js";

describe("cronMatchesMinute", () => {
  it("matches 08:00 in Asia/Ho_Chi_Minh", () => {
    // 2026-03-15 01:00 UTC == 08:00 ICT
    const date = new Date("2026-03-15T01:00:00.000Z");
    expect(cronMatchesMinute("0 8 * * *", date, "Asia/Ho_Chi_Minh")).toBe(true);
    expect(cronMatchesMinute("0 9 * * *", date, "Asia/Ho_Chi_Minh")).toBe(false);
  });
});
