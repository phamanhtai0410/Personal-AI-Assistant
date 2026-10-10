import {
  Agent,
  Cursor,
  CursorAgentError,
  type AgentUsage,
  type SDKAgent,
  type SDKMessage,
  type TokenUsage,
} from "@cursor/sdk";
import type { AppConfig } from "./config.js";
import { listAvailableModels } from "./models.js";

export type StreamHandlers = {
  onAssistantText?: (text: string) => void | Promise<void>;
  onTool?: (name: string, status: string) => void | Promise<void>;
  onStatus?: (status: string) => void | Promise<void>;
};

export type RunOutcome = {
  agentId: string;
  runId: string;
  status: string;
  resultText: string;
  usageSummary: string | null;
  modelId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export interface CursorRuntime {
  send(input: {
    sessionKey: string;
    agentId: string | null;
    modelId: string;
    prompt: string;
    handlers?: StreamHandlers;
    signal?: AbortSignal;
  }): Promise<RunOutcome>;
  cancelActive(sessionKey: string): Promise<boolean>;
  getUsageSummary(agentId: string): Promise<string>;
  listModels(): Promise<Awaited<ReturnType<typeof listAvailableModels>>>;
  getAccountHint(): Promise<string>;
}

type ActiveRun = {
  run: Awaited<ReturnType<SDKAgent["send"]>>;
  agent: SDKAgent;
};

export function createCursorRuntime(config: AppConfig): CursorRuntime {
  const activeBySession = new Map<string, ActiveRun>();

  async function openAgent(
    agentId: string | null,
    modelId: string,
  ): Promise<SDKAgent> {
    const base = {
      ...(config.cursorApiKey ? { apiKey: config.cursorApiKey } : {}),
      model: { id: modelId },
      local: {
        cwd: config.vaultDir,
        settingSources: ["project" as const],
      },
    };

    if (agentId) {
      return Agent.resume(agentId, base);
    }
    return Agent.create(base);
  }

  return {
    async send({ sessionKey, agentId, modelId, prompt, handlers, signal }) {
      const agent = await openAgent(agentId, modelId);
      try {
        // Per-send model makes the selection sticky for follow-ups on this agent.
        const run = await agent.send(prompt, { model: { id: modelId } });
        const handle: ActiveRun = { run, agent };
        activeBySession.set(sessionKey, handle);

        console.log(
          `[cursor] session=${sessionKey} agent=${agent.agentId} run=${run.id} model=${modelId}`,
        );

        if (signal) {
          const onAbort = () => {
            void (async () => {
              if (run.supports("cancel")) {
                await run.cancel();
              }
            })();
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }

        let assistantText = "";
        if (run.supports("stream")) {
          for await (const event of run.stream()) {
            await dispatchStreamEvent(event, handlers, (chunk) => {
              assistantText += chunk;
            });
          }
        }

        const result = await run.wait();
        const resultText =
          result.result?.trim() ||
          assistantText.trim() ||
          `(run ${result.status})`;

        const usageSummary = result.usage
          ? formatTokenUsage(result.usage)
          : null;

        console.log(
          `[cursor] agent=${agent.agentId} run=${result.id} status=${result.status}`,
        );

        return {
          agentId: agent.agentId,
          runId: result.id,
          status: result.status,
          resultText,
          usageSummary,
          modelId: result.model?.id ?? modelId,
          inputTokens: result.usage?.inputTokens ?? null,
          outputTokens: result.usage?.outputTokens ?? null,
          totalTokens: result.usage?.totalTokens ?? null,
        };
      } catch (err) {
        if (err instanceof CursorAgentError) {
          const hint = err.isRetryable
            ? "Transient Cursor error — try again shortly."
            : "Cursor startup failed — check API key, model id, and local runtime.";
          throw new Error(`${hint} (${err.message})`, { cause: err });
        }
        throw err;
      } finally {
        activeBySession.delete(sessionKey);
        await agent[Symbol.asyncDispose]();
      }
    },

    async cancelActive(sessionKey: string) {
      const handle = activeBySession.get(sessionKey);
      if (!handle) return false;
      if (handle.run.supports("cancel")) {
        await handle.run.cancel();
        return true;
      }
      return false;
    },

    async getUsageSummary(agentId: string) {
      try {
        const usage = await Agent.getUsage(agentId, {
          ...(config.cursorApiKey ? { apiKey: config.cursorApiKey } : {}),
        });
        return formatAgentUsage(usage);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/feature_unavailable/i.test(message)) {
          return "Per-agent getUsage() not enabled for this account yet.";
        }
        return `Agent usage unavailable: ${message}`;
      }
    },

    async listModels() {
      return listAvailableModels(config.cursorApiKey);
    },

    async getAccountHint() {
      try {
        const me = await Cursor.me({
          ...(config.cursorApiKey ? { apiKey: config.cursorApiKey } : {}),
        });
        const who = me.userEmail ?? me.apiKeyName ?? "unknown";
        return `API key: ${who}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Account lookup failed: ${message}`;
      }
    },
  };
}

async function dispatchStreamEvent(
  event: SDKMessage,
  handlers: StreamHandlers | undefined,
  onText: (chunk: string) => void,
): Promise<void> {
  if (event.type === "assistant") {
    for (const block of event.message.content) {
      if (block.type === "text" && block.text) {
        onText(block.text);
        await handlers?.onAssistantText?.(block.text);
      }
    }
    return;
  }

  if (event.type === "tool_call") {
    await handlers?.onTool?.(event.name, event.status);
    return;
  }

  if (event.type === "status") {
    await handlers?.onStatus?.(event.status);
  }
}

function formatTokenUsage(usage: TokenUsage): string {
  return `in=${usage.inputTokens} out=${usage.outputTokens} total=${usage.totalTokens}`;
}

function formatAgentUsage(usage: AgentUsage): string {
  const runs = usage.runs.length;
  const charged = usage.cost
    ? `$${(usage.cost.chargedCents / 100).toFixed(2)}`
    : "n/a (included/BYOK)";
  return `agent runs=${runs} tokens=${usage.usage.totalTokens} billed=${charged}`;
}
