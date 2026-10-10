import type { AppConfig } from "./config.js";
import { isAllowedUser } from "./config.js";
import type { PaiDatabase } from "./db.js";
import type { CursorRuntime } from "./cursor-runtime.js";
import { SessionQueue, type QueuedMessage } from "./queue.js";
import {
  buildSessionKey,
  canStartRun,
  todayInTimezone,
} from "./sessions.js";
import {
  buildUserPrompt,
  channelMemoryDir,
  ensureChannelVault,
  isDirectMessage,
  readVaultSnippet,
} from "./vault.js";
import {
  formatModelsList,
  GLOBAL_MODEL_SETTING,
  matchModelId,
  resolveModelId,
} from "./models.js";
import {
  SlackStreamUpdater,
  type SlackPoster,
} from "./slack/stream.js";

export type IncomingSlackMessage = {
  userId: string;
  channel: string;
  text: string;
  threadTs: string | null;
  messageTs: string;
  channelName?: string;
};

export class Gateway {
  private readonly queue = new SessionQueue();
  private readonly abortControllers = new Map<string, AbortController>();
  /** Channel threads we should continue without another @mention. */
  private readonly watchedThreads = new Set<string>();
  private readonly recentMessageTs = new Map<string, number>();

  constructor(
    private readonly config: AppConfig,
    private readonly db: PaiDatabase,
    private readonly runtime: CursorRuntime,
    private readonly poster: SlackPoster,
  ) {}

  isThreadWatched(sessionKey: string): boolean {
    if (this.watchedThreads.has(sessionKey)) return true;
    return this.db.getSession(sessionKey) != null;
  }

  watchThread(sessionKey: string): void {
    this.watchedThreads.add(sessionKey);
  }

  async handleMessage(msg: IncomingSlackMessage): Promise<void> {
    if (!isAllowedUser(msg.userId, this.config.slackAllowedUserIds)) {
      console.warn(`[gateway] ignore unauthorized user=${msg.userId}`);
      return;
    }

    if (this.isDuplicateMessage(msg.messageTs)) {
      console.log(`[gateway] skip duplicate messageTs=${msg.messageTs}`);
      return;
    }

    const text = msg.text.trim();
    if (!text) return;

    const sessionKey = buildSessionKey({
      channel: msg.channel,
      threadTs: msg.threadTs,
    });

    console.log(
      `[gateway] inbound user=${msg.userId} channel=${msg.channel} session=${sessionKey} text=${JSON.stringify(text)}`,
    );

    if (!isDirectMessage(msg.channel)) {
      await ensureChannelVault(
        this.config.vaultDir,
        msg.channel,
        msg.channelName,
      );
      this.watchThread(sessionKey);
    }

    if (text === "/new" || text.startsWith("/new ")) {
      this.db.clearAgent(sessionKey);
      this.watchedThreads.delete(sessionKey);
      console.log(`[gateway] /new cleared agent for ${sessionKey}`);
      await this.poster.postMessage({
        channel: msg.channel,
        text: "Started a fresh Cursor agent for this conversation.",
        ...(msg.threadTs ? { thread_ts: msg.threadTs } : {}),
      });
      // Keep watching the thread so follow-ups still route after /new.
      if (!isDirectMessage(msg.channel) && msg.threadTs) {
        this.watchThread(sessionKey);
      }
      return;
    }

    if (text === "/stop" || text.startsWith("/stop ")) {
      const ac = this.abortControllers.get(sessionKey);
      ac?.abort();
      const cancelled = await this.runtime.cancelActive(sessionKey);
      this.queue.clearPending(sessionKey);
      console.log(
        `[gateway] /stop session=${sessionKey} cancelled=${cancelled}`,
      );
      await this.poster.postMessage({
        channel: msg.channel,
        text: cancelled
          ? "Cancelled the active run."
          : "No active run to cancel.",
        ...(msg.threadTs ? { thread_ts: msg.threadTs } : {}),
      });
      return;
    }

    if (text === "/models" || text.startsWith("/models ")) {
      await this.handleModelsCommand(msg, sessionKey);
      return;
    }

    if (text === "/model" || text.startsWith("/model ")) {
      await this.handleModelCommand(msg, sessionKey, text);
      return;
    }

    if (text === "/usage" || text.startsWith("/usage ")) {
      await this.handleUsageCommand(msg, sessionKey);
      return;
    }

    if (this.queue.isBusy(sessionKey)) {
      while (this.db.dequeueOutbox(sessionKey)) {
        /* replace */
      }
      this.db.enqueueOutbox(sessionKey, toQueued(msg));
      await this.poster.postMessage({
        channel: msg.channel,
        text: "_Queued — will run after the current turn (replaces any previous queued message)._",
        ...(msg.threadTs ? { thread_ts: msg.threadTs } : {}),
      });
      return;
    }

    if (!this.queue.tryAcquire(sessionKey)) {
      this.db.enqueueOutbox(sessionKey, toQueued(msg));
      return;
    }

    await this.runTurn(sessionKey, toQueued(msg));
  }

  private async handleModelsCommand(
    msg: IncomingSlackMessage,
    sessionKey: string,
  ): Promise<void> {
    const current = resolveModelId(this.db, this.config, sessionKey);
    try {
      const models = await this.runtime.listModels();
      console.log(`[gateway] /models count=${models.length}`);
      await this.poster.postMessage({
        channel: msg.channel,
        text: formatModelsList(models, current.modelId),
        ...(msg.threadTs ? { thread_ts: msg.threadTs } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.poster.postMessage({
        channel: msg.channel,
        text: `Failed to list models: ${message}`,
        ...(msg.threadTs ? { thread_ts: msg.threadTs } : {}),
      });
    }
  }

  private async handleModelCommand(
    msg: IncomingSlackMessage,
    sessionKey: string,
    text: string,
  ): Promise<void> {
    const arg = text.replace(/^\/model\s*/i, "").trim();
    const current = resolveModelId(this.db, this.config, sessionKey);

    if (!arg) {
      await this.poster.postMessage({
        channel: msg.channel,
        text: [
          `*Current model*: \`${current.modelId}\` _(source: ${current.source})_`,
          "In a thread, type (no leading `/`):",
          "• `models` — list",
          "• `model <id>` — switch this chat",
          "• `model global <id>` — workspace default",
          "Or `@PAI models` / `@PAI model composer-2`",
          "_Slack slash commands like `/model` are not supported in threads._",
        ].join("\n"),
        ...(msg.threadTs ? { thread_ts: msg.threadTs } : {}),
      });
      return;
    }

    const globalMatch = arg.match(/^global\s+(\S+)/i);
    const requested = globalMatch?.[1] ?? arg;
    const asGlobal = Boolean(globalMatch);

    try {
      const models = await this.runtime.listModels();
      const matched = matchModelId(requested, models);
      if (!matched) {
        await this.poster.postMessage({
          channel: msg.channel,
          text: [
            `Unknown model \`${requested}\`.`,
            "Type `models` (or `@PAI models`) to see ids on your Cursor account.",
          ].join("\n"),
          ...(msg.threadTs ? { thread_ts: msg.threadTs } : {}),
        });
        return;
      }

      if (asGlobal) {
        this.db.setSetting(GLOBAL_MODEL_SETTING, matched.id);
        console.log(`[gateway] /model global → ${matched.id}`);
        await this.poster.postMessage({
          channel: msg.channel,
          text: `Global default model set to \`${matched.id}\` (${matched.displayName}). New chats without a session override will use it.`,
          ...(msg.threadTs ? { thread_ts: msg.threadTs } : {}),
        });
        return;
      }

      this.db.setSessionModel(sessionKey, matched.id);
      // Ensure session row has channel metadata for later upserts.
      this.db.upsertSession({
        sessionKey,
        agentId: this.db.getSession(sessionKey)?.agent_id ?? null,
        channel: msg.channel,
        threadTs: msg.threadTs,
        modelId: matched.id,
      });
      console.log(`[gateway] /model session=${sessionKey} → ${matched.id}`);
      await this.poster.postMessage({
        channel: msg.channel,
        text: `This chat will use \`${matched.id}\` (${matched.displayName}) on the next turn.`,
        ...(msg.threadTs ? { thread_ts: msg.threadTs } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.poster.postMessage({
        channel: msg.channel,
        text: `Failed to set model: ${message}`,
        ...(msg.threadTs ? { thread_ts: msg.threadTs } : {}),
      });
    }
  }

  private async handleUsageCommand(
    msg: IncomingSlackMessage,
    sessionKey: string,
  ): Promise<void> {
    const session = this.db.getSession(sessionKey);
    const day = todayInTimezone(this.config.timezone);
    const count = this.db.getDailyRunCount(day);
    const tokens = this.db.getDayTokenStats(day);
    const model = resolveModelId(this.db, this.config, sessionKey);
    const account = await this.runtime.getAccountHint();

    let agentLine = "No agent for this session yet.";
    if (session?.agent_id) {
      agentLine = await this.runtime.getUsageSummary(session.agent_id);
    }

    console.log(
      `[gateway] /usage session=${sessionKey} agent=${session?.agent_id ?? "none"} daily=${count}/${this.config.dailyRunCap}`,
    );

    await this.poster.postMessage({
      channel: msg.channel,
      text: [
        `*Usage*`,
        `• Model: \`${model.modelId}\` _(source: ${model.source})_`,
        `• PAI daily runs: ${count}/${this.config.dailyRunCap} (${day})`,
        `• PAI tokens today (logged): in=${tokens.inputTokens} out=${tokens.outputTokens} total=${tokens.totalTokens} over ${tokens.runs} finished runs`,
        `• Agent: \`${session?.agent_id ?? "none"}\``,
        `• ${agentLine}`,
        `• ${account}`,
        isDirectMessage(msg.channel)
          ? `• Memory: \`MEMORY.md\` (workspace)`
          : `• Memory: \`MEMORY.md\` + \`${channelMemoryDir(msg.channel)}/MEMORY.md\``,
        "",
        "_Cursor Pro remaining allowance is not exposed by the SDK._",
        "Check the dashboard: https://cursor.com/dashboard (Usage / SDK tag).",
        "If a model pool is exhausted: `models` then `model <id>` (or `@PAI model <id>`).",
        "_Do not use `/model` inside a thread — Slack blocks slash commands there._",
      ].join("\n"),
      ...(msg.threadTs ? { thread_ts: msg.threadTs } : {}),
    });
  }

  private isDuplicateMessage(messageTs: string): boolean {
    const now = Date.now();
    for (const [ts, at] of this.recentMessageTs) {
      if (now - at > 60_000) this.recentMessageTs.delete(ts);
    }
    if (this.recentMessageTs.has(messageTs)) return true;
    this.recentMessageTs.set(messageTs, now);
    return false;
  }

  private async runTurn(
    sessionKey: string,
    msg: QueuedMessage,
  ): Promise<void> {
    const day = todayInTimezone(this.config.timezone);
    const count = this.db.getDailyRunCount(day);
    const gate = canStartRun(count, this.config.dailyRunCap);
    if (!gate.ok) {
      await this.poster.postMessage({
        channel: msg.channel,
        text: gate.reason,
        ...(msg.threadTs ? { thread_ts: msg.threadTs } : {}),
      });
      this.finishAndDrain(sessionKey);
      return;
    }

    const session = this.db.getSession(sessionKey);
    const stream = new SlackStreamUpdater(
      this.poster,
      msg.channel,
      msg.threadTs,
    );
    await stream.start();

    const abort = new AbortController();
    this.abortControllers.set(sessionKey, abort);

    try {
      this.db.incrementDailyRun(day);
      const surface = isDirectMessage(msg.channel) ? "dm" : "channel";
      const channelRel = channelMemoryDir(msg.channel);
      const [memorySnippet, userSnippet, channelMemorySnippet] =
        await Promise.all([
          readVaultSnippet(this.config.vaultDir, "MEMORY.md"),
          readVaultSnippet(this.config.vaultDir, "USER.md"),
          surface === "channel"
            ? readVaultSnippet(
                this.config.vaultDir,
                `${channelRel}/MEMORY.md`,
              )
            : Promise.resolve(""),
        ]);

      const prompt = buildUserPrompt({
        userText: msg.text,
        memorySnippet,
        userSnippet,
        channelMemorySnippet,
        channelId: msg.channel,
        surface,
        ...(msg.channelName ? { channelName: msg.channelName } : {}),
      });

      const model = resolveModelId(this.db, this.config, sessionKey);
      const outcome = await this.runtime.send({
        sessionKey,
        agentId: session?.agent_id ?? null,
        modelId: model.modelId,
        prompt,
        signal: abort.signal,
        handlers: {
          onAssistantText: (t) => stream.appendText(t),
          onTool: (name, status) => stream.setTool(name, status),
        },
      });

      this.db.upsertSession({
        sessionKey,
        agentId: outcome.agentId,
        channel: msg.channel,
        threadTs: msg.threadTs,
        modelId: outcome.modelId,
      });
      this.watchThread(sessionKey);
      this.db.logRun({
        sessionKey,
        agentId: outcome.agentId,
        runId: outcome.runId,
        status: outcome.status,
        modelId: outcome.modelId,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        totalTokens: outcome.totalTokens,
        day,
      });

      let final = outcome.resultText;
      if (outcome.status !== "finished") {
        final = `${final}\n\n_Status: ${outcome.status} · run \`${outcome.runId}\`_`;
      }
      if (outcome.usageSummary) {
        final = `${final}\n\n_${outcome.modelId} · ${outcome.usageSummary}_`;
      } else {
        final = `${final}\n\n_model \`${outcome.modelId}\`_`;
      }
      await stream.finish(final);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[gateway] session=${sessionKey} error:`, err);
      await stream.finish(`Error: ${message}`);
    } finally {
      this.abortControllers.delete(sessionKey);
      this.finishAndDrain(sessionKey);
    }
  }

  private finishAndDrain(sessionKey: string): void {
    this.queue.release(sessionKey);
    const fromDb = this.db.dequeueOutbox(sessionKey);
    if (!fromDb) return;

    let queued: QueuedMessage;
    try {
      queued = JSON.parse(fromDb.payload_json) as QueuedMessage;
    } catch (err) {
      console.error(
        `[gateway] corrupt outbox row id=${fromDb.id}, discarding`,
        err,
      );
      return;
    }

    if (!this.queue.tryAcquire(sessionKey)) {
      this.db.enqueueOutbox(sessionKey, queued);
      return;
    }
    void this.runTurn(sessionKey, queued).catch((err) => {
      console.error(
        `[gateway] drain runTurn failed session=${sessionKey}:`,
        err,
      );
    });
  }
}

function toQueued(msg: IncomingSlackMessage): QueuedMessage {
  return {
    text: msg.text,
    userId: msg.userId,
    channel: msg.channel,
    threadTs: msg.threadTs,
    messageTs: msg.messageTs,
    ...(msg.channelName ? { channelName: msg.channelName } : {}),
  };
}
