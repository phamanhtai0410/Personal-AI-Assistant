import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const envSchema = z.object({
  CURSOR_API_KEY: z.string().min(1).optional(),
  SLACK_BOT_TOKEN: z.string().trim().startsWith("xoxb-"),
  SLACK_APP_TOKEN: z.string().trim().startsWith("xapp-"),
  /** Comma-separated Slack user IDs allowed to talk to the bot. */
  SLACK_ALLOWED_USER_ID: z.string().trim().min(1),
  PAI_VAULT_DIR: z.string().default("./vault"),
  PAI_DATA_DIR: z.string().default("./data"),
  PAI_DB_PATH: z.string().optional(),
  PAI_MODEL_ID: z.string().default("composer-2"),
  PAI_DAILY_RUN_CAP: z.coerce.number().int().positive().default(40),
  PAI_BRIEFING_CRON: z.string().default("0 8 * * *"),
  PAI_BRIEFING_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  PAI_TIMEZONE: z.string().default("Asia/Ho_Chi_Minh"),
  PAI_BRIEFING_CHANNEL: z.string().optional(),
  PAI_RUNTIME: z.enum(["local", "cloud"]).default("local"),
  NODE_ENV: z.string().optional(),
});

export type AppConfig = {
  cursorApiKey: string | undefined;
  slackBotToken: string;
  slackAppToken: string;
  /** First allowed user (back-compat); prefer slackAllowedUserIds. */
  slackAllowedUserId: string;
  slackAllowedUserIds: string[];
  vaultDir: string;
  dataDir: string;
  dbPath: string;
  modelId: string;
  dailyRunCap: number;
  briefingCron: string;
  briefingEnabled: boolean;
  timezone: string;
  briefingChannel: string | undefined;
  runtime: "local" | "cloud";
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  const e = parsed.data;
  const vaultDir = resolve(e.PAI_VAULT_DIR);
  const dataDir = resolve(e.PAI_DATA_DIR);
  const dbPath = resolve(e.PAI_DB_PATH ?? joinPath(dataDir, "pai.db"));

  mkdirSync(vaultDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const slackAllowedUserIds = e.SLACK_ALLOWED_USER_ID.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const primaryAllowed = slackAllowedUserIds[0];
  if (!primaryAllowed) {
    throw new Error("SLACK_ALLOWED_USER_ID must contain at least one user id");
  }

  return {
    cursorApiKey: e.CURSOR_API_KEY,
    slackBotToken: e.SLACK_BOT_TOKEN,
    slackAppToken: e.SLACK_APP_TOKEN,
    slackAllowedUserId: primaryAllowed,
    slackAllowedUserIds,
    vaultDir,
    dataDir,
    dbPath,
    modelId: e.PAI_MODEL_ID,
    dailyRunCap: e.PAI_DAILY_RUN_CAP,
    briefingCron: e.PAI_BRIEFING_CRON,
    briefingEnabled: e.PAI_BRIEFING_ENABLED,
    timezone: e.PAI_TIMEZONE,
    briefingChannel: e.PAI_BRIEFING_CHANNEL,
    runtime: e.PAI_RUNTIME,
  };
}

function joinPath(a: string, b: string): string {
  return resolve(a, b);
}

export function isAllowedUser(
  userId: string,
  allowed: string | string[],
): boolean {
  if (Array.isArray(allowed)) return allowed.includes(userId);
  return allowed.split(",").map((s) => s.trim()).includes(userId);
}
