import { describe, expect, it } from "vitest";
import { isAllowedUser, loadConfig } from "../src/config.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("isAllowedUser", () => {
  it("matches exactly", () => {
    expect(isAllowedUser("U1", "U1")).toBe(true);
    expect(isAllowedUser("U2", "U1")).toBe(false);
  });
});

describe("loadConfig", () => {
  it("loads from env", () => {
    const root = mkdtempSync(join(tmpdir(), "pai-cfg-"));
    const cfg = loadConfig({
      SLACK_BOT_TOKEN: "xoxb-test",
      SLACK_APP_TOKEN: "xapp-test",
      SLACK_ALLOWED_USER_ID: "U123",
      PAI_VAULT_DIR: join(root, "vault"),
      PAI_DATA_DIR: join(root, "data"),
      PAI_DAILY_RUN_CAP: "10",
      PAI_BRIEFING_ENABLED: "false",
    });
    expect(cfg.dailyRunCap).toBe(10);
    expect(cfg.briefingEnabled).toBe(false);
    expect(cfg.slackAllowedUserId).toBe("U123");
  });
});
