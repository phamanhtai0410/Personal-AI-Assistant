/**
 * Throttled Slack message updater for streaming agent output.
 * Plan option 9A: post once, then chat.update at most ~1/sec.
 */

import { markdownToMrkdwn } from "./mrkdwn.js";

export const SLACK_TEXT_LIMIT = 3500;

export type SlackPoster = {
  postMessage: (args: {
    channel: string;
    text: string;
    thread_ts?: string;
  }) => Promise<{ ts: string; channel: string }>;
  updateMessage: (args: {
    channel: string;
    ts: string;
    text: string;
  }) => Promise<void>;
};

export class SlackStreamUpdater {
  private buffer = "";
  private toolLine = "";
  private messageTs: string | null = null;
  private channel: string;
  private readonly threadTs: string | undefined;
  private lastFlush = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly minIntervalMs: number;

  constructor(
    private readonly poster: SlackPoster,
    channel: string,
    threadTs: string | null,
    minIntervalMs = 1000,
  ) {
    this.channel = channel;
    this.threadTs = threadTs ?? undefined;
    this.minIntervalMs = minIntervalMs;
  }

  async start(placeholder = "_Thinking…_"): Promise<void> {
    const posted = await this.poster.postMessage({
      channel: this.channel,
      text: placeholder,
      ...(this.threadTs ? { thread_ts: this.threadTs } : {}),
    });
    this.messageTs = posted.ts;
    this.channel = posted.channel;
  }

  appendText(chunk: string): void {
    this.buffer += chunk;
    this.scheduleFlush();
  }

  setTool(name: string, status: string): void {
    this.toolLine = `⚙ \`${name}\` (${status})`;
    this.scheduleFlush();
  }

  async finish(finalText?: string): Promise<string> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (finalText != null && finalText.trim()) {
      this.buffer = finalText;
    }
    this.toolLine = "";
    await this.flush(true);
    return this.buffer;
  }

  private scheduleFlush(): void {
    const now = Date.now();
    const elapsed = now - this.lastFlush;
    if (elapsed >= this.minIntervalMs) {
      void this.flush(false).catch((err) =>
        console.error("[stream] flush error:", err),
      );
      return;
    }
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush(false).catch((err) =>
        console.error("[stream] flush error:", err),
      );
    }, this.minIntervalMs - elapsed);
  }

  private async flush(force: boolean): Promise<void> {
    if (!this.messageTs) return;
    if (!force && Date.now() - this.lastFlush < this.minIntervalMs) return;

    const text = formatSlackBody(this.buffer, this.toolLine);
    await this.poster.updateMessage({
      channel: this.channel,
      ts: this.messageTs,
      text,
    });
    this.lastFlush = Date.now();
  }
}

export function formatSlackBody(buffer: string, toolLine: string): string {
  const body = markdownToMrkdwn(buffer.trim() || "_…_");
  const withTool = toolLine ? `${body}\n\n${toolLine}` : body;
  if (withTool.length <= SLACK_TEXT_LIMIT) return withTool;
  const note =
    "\n\n_(truncated — full answer may be longer; ask me to write details into the vault)_";
  const budget = SLACK_TEXT_LIMIT - note.length;
  return `${withTool.slice(0, budget)}${note}`;
}
