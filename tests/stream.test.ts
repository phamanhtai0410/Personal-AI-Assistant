import { describe, expect, it } from "vitest";
import { formatSlackBody, SLACK_TEXT_LIMIT } from "../src/slack/stream.js";

describe("formatSlackBody", () => {
  it("includes tool line", () => {
    expect(formatSlackBody("hello", "⚙ `read` (running)")).toContain("read");
  });

  it("truncates long bodies", () => {
    const body = "x".repeat(SLACK_TEXT_LIMIT + 500);
    const formatted = formatSlackBody(body, "");
    expect(formatted.length).toBeLessThanOrEqual(SLACK_TEXT_LIMIT);
    expect(formatted).toContain("truncated");
  });
});
