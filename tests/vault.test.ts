import { describe, expect, it } from "vitest";
import {
  buildUserPrompt,
  channelMemoryDir,
  stripSlackMentions,
} from "../src/vault.js";

describe("buildUserPrompt", () => {
  it("includes slack message and snippets for DM", () => {
    const prompt = buildUserPrompt({
      userText: "Nhắc tôi lịch họp",
      memorySnippet: "Open loop: taxes",
      userSnippet: "Timezone: Asia/Ho_Chi_Minh",
      surface: "dm",
    });
    expect(prompt).toContain("Nhắc tôi lịch họp");
    expect(prompt).toContain("taxes");
    expect(prompt).toContain("Asia/Ho_Chi_Minh");
    expect(prompt).toContain("surface: dm");
  });

  it("includes channel memory path for channel surface", () => {
    const prompt = buildUserPrompt({
      userText: "ship checklist",
      memorySnippet: "workspace fact",
      userSnippet: "me",
      channelMemorySnippet: "channel fact",
      channelId: "C123",
      channelName: "eng",
      surface: "channel",
    });
    expect(prompt).toContain("channel fact");
    expect(prompt).toContain("#eng");
    expect(prompt).toContain(channelMemoryDir("C123"));
  });
});

describe("stripSlackMentions", () => {
  it("removes user mentions", () => {
    expect(stripSlackMentions("<@U123> please help")).toBe("please help");
  });
});
