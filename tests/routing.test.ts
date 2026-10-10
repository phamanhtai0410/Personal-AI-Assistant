import { describe, expect, it } from "vitest";
import { routeSlackMessage } from "../src/slack/routing.js";
import { buildSessionKey } from "../src/sessions.js";

describe("routeSlackMessage", () => {
  const watched = new Set<string>();

  const base = {
    buildSessionKey,
    isThreadWatched: (key: string) => watched.has(key),
  };

  it("handles all DMs", () => {
    const d = routeSlackMessage({
      ...base,
      channelId: "D123",
      threadTs: null,
      messageTs: "1.0",
      text: "hi",
      source: "message",
    });
    expect(d.handle).toBe(true);
    if (d.handle) expect(d.reason).toBe("dm");
  });

  it("ignores bare channel messages", () => {
    const d = routeSlackMessage({
      ...base,
      channelId: "C123",
      threadTs: null,
      messageTs: "1.0",
      text: "random chat",
      source: "message",
    });
    expect(d.handle).toBe(false);
  });

  it("handles app_mention and opens a thread", () => {
    const d = routeSlackMessage({
      ...base,
      channelId: "C123",
      threadTs: null,
      messageTs: "9.0",
      text: "<@UBOT> help",
      source: "app_mention",
    });
    expect(d.handle).toBe(true);
    if (d.handle) {
      expect(d.replyInThreadTs).toBe("9.0");
    }
  });

  it("handles watched thread follow-ups", () => {
    const key = buildSessionKey({ channel: "C123", threadTs: "9.0" });
    watched.add(key);
    const d = routeSlackMessage({
      ...base,
      channelId: "C123",
      threadTs: "9.0",
      messageTs: "10.0",
      text: "continue",
      source: "message",
    });
    expect(d.handle).toBe(true);
    if (d.handle) expect(d.reason).toBe("watched_thread");
  });
});
