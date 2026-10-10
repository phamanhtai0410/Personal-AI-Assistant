import { App, LogLevel } from "@slack/bolt";
import type { AppConfig } from "../config.js";
import type { Gateway } from "../gateway.js";
import { buildSessionKey } from "../sessions.js";
import { stripSlackMentions } from "../vault.js";
import { routeSlackMessage } from "./routing.js";
import type { SlackPoster } from "./stream.js";

const SLASH_COMMANDS = [
  "/new",
  "/stop",
  "/usage",
  "/models",
  "/model",
] as const;

export function createSlackApp(config: AppConfig): {
  app: App;
  poster: SlackPoster;
} {
  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
    logLevel: process.env.DEBUG ? LogLevel.DEBUG : LogLevel.INFO,
  });

  const poster: SlackPoster = {
    async postMessage({ channel, text, thread_ts }) {
      const result = await app.client.chat.postMessage({
        channel,
        text,
        ...(thread_ts ? { thread_ts } : {}),
      });
      if (!result.ts || !result.channel) {
        throw new Error("Slack postMessage missing ts/channel");
      }
      return { ts: result.ts, channel: result.channel };
    },
    async updateMessage({ channel, ts, text }) {
      await app.client.chat.update({ channel, ts, text });
    },
  };

  return { app, poster };
}

export function registerSlackHandlers(app: App, gateway: Gateway): void {
  app.message(async ({ message, say, client }) => {
    if (message.subtype || !("text" in message) || !message.text) return;
    if (!("user" in message) || !message.user) return;
    if ("bot_id" in message && message.bot_id) return;

    const channel = message.channel;
    const threadTs =
      "thread_ts" in message &&
      typeof message.thread_ts === "string" &&
      message.thread_ts !== message.ts
        ? message.thread_ts
        : null;

    const route = routeSlackMessage({
      channelId: channel,
      threadTs,
      messageTs: message.ts,
      text: message.text,
      source: "message",
      isThreadWatched: (key) => gateway.isThreadWatched(key),
      buildSessionKey,
    });

    if (!route.handle) {
      console.log(
        `[slack] skip message channel=${channel} reason=${route.reason}`,
      );
      return;
    }

    const text = normalizeCommandText(stripSlackMentions(message.text));
    const channelName = await resolveChannelName(client, channel);

    try {
      await gateway.handleMessage({
        userId: message.user,
        channel,
        text,
        threadTs: route.replyInThreadTs,
        messageTs: message.ts,
        ...(channelName ? { channelName } : {}),
      });
    } catch (err) {
      console.error("[slack] handler error:", err);
      await say({
        text: `Gateway error: ${err instanceof Error ? err.message : String(err)}`,
        ...(route.replyInThreadTs
          ? { thread_ts: route.replyInThreadTs }
          : {}),
      });
    }
  });

  app.event("app_mention", async ({ event, say, client }) => {
    if (!event.user || !event.text) return;

    const threadTs =
      "thread_ts" in event && typeof event.thread_ts === "string"
        ? event.thread_ts
        : null;

    const route = routeSlackMessage({
      channelId: event.channel,
      threadTs,
      messageTs: event.ts,
      text: event.text,
      source: "app_mention",
      isThreadWatched: (key) => gateway.isThreadWatched(key),
      buildSessionKey,
    });

    if (!route.handle) return;

    const text = normalizeCommandText(stripSlackMentions(event.text));
    if (!text) {
      await say({
        text: "Mention me with a request, or in this thread type `usage`, `models`, `model <id>`, `new`, `stop` (no leading `/`).",
        thread_ts: route.replyInThreadTs ?? event.ts,
      });
      return;
    }

    const channelName = await resolveChannelName(client, event.channel);

    try {
      await gateway.handleMessage({
        userId: event.user,
        channel: event.channel,
        text,
        threadTs: route.replyInThreadTs,
        messageTs: event.ts,
        ...(channelName ? { channelName } : {}),
      });
    } catch (err) {
      console.error("[slack] app_mention error:", err);
      await say({
        text: `Gateway error: ${err instanceof Error ? err.message : String(err)}`,
        thread_ts: route.replyInThreadTs ?? event.ts,
      });
    }
  });

  for (const command of SLASH_COMMANDS) {
    app.command(command, async ({ command: cmd, ack, respond, client }) => {
      await ack();
      const arg = cmd.text?.trim() ?? "";
      const text = arg ? `${command} ${arg}` : command;
      const channelName = await resolveChannelName(client, cmd.channel_id);

      try {
        await gateway.handleMessage({
          userId: cmd.user_id,
          channel: cmd.channel_id,
          text,
          threadTs: null,
          messageTs: `${Date.now() / 1000}`,
          ...(channelName ? { channelName } : {}),
        });
      } catch (err) {
        console.error(`[slack] ${command} error:`, err);
        await respond({
          response_type: "ephemeral",
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });
  }
}

async function resolveChannelName(
  client: {
    conversations: {
      info: (args: { channel: string }) => Promise<{
        channel?: { name?: string; is_im?: boolean };
      }>;
    };
  },
  channelId: string,
): Promise<string | undefined> {
  if (channelId.startsWith("D")) return undefined;
  try {
    const info = await client.conversations.info({ channel: channelId });
    return info.channel?.name;
  } catch (err) {
    console.warn(`[slack] conversations.info failed for ${channelId}:`, err);
    return undefined;
  }
}

/** Map `!new` / `new` style aliases to slash form for message handlers. */
export function normalizeCommandText(raw: string): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "!new" || lower === "new") return "/new";
  if (lower === "!stop" || lower === "stop") return "/stop";
  if (lower === "!usage" || lower === "usage") return "/usage";
  if (lower === "!models" || lower === "models") return "/models";
  if (lower === "!model" || lower === "model") return "/model";

  if (lower.startsWith("!new ")) return `/new ${trimmed.slice(5)}`;
  if (lower.startsWith("!stop ")) return `/stop ${trimmed.slice(6)}`;
  if (lower.startsWith("!usage ")) return `/usage ${trimmed.slice(7)}`;
  if (lower.startsWith("!models ")) return `/models ${trimmed.slice(8)}`;
  if (lower.startsWith("!model ")) return `/model ${trimmed.slice(7)}`;
  if (lower.startsWith("model ")) return `/model ${trimmed.slice(6)}`;
  if (lower.startsWith("models ")) return `/models ${trimmed.slice(7)}`;

  return trimmed;
}
