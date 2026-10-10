import { Cursor, type ModelListItem } from "@cursor/sdk";
import type { AppConfig } from "./config.js";
import type { PaiDatabase } from "./db.js";

export const GLOBAL_MODEL_SETTING = "default_model_id";

export type ModelResolution = {
  modelId: string;
  source: "session" | "global" | "env";
};

export function resolveModelId(
  db: PaiDatabase,
  config: AppConfig,
  sessionKey: string,
): ModelResolution {
  const session = db.getSession(sessionKey);
  if (session?.model_id) {
    return { modelId: session.model_id, source: "session" };
  }
  const global = db.getSetting(GLOBAL_MODEL_SETTING);
  if (global) {
    return { modelId: global, source: "global" };
  }
  return { modelId: config.modelId, source: "env" };
}

export async function listAvailableModels(
  apiKey: string | undefined,
): Promise<ModelListItem[]> {
  return Cursor.models.list({
    ...(apiKey ? { apiKey } : {}),
  });
}

export function formatModelsList(models: ModelListItem[], currentId: string): string {
  if (models.length === 0) {
    return "No models returned by Cursor.models.list() for this account.";
  }

  const lines = models.slice(0, 40).map((m) => {
    const mark = m.id === currentId ? "→ " : "  ";
    const aliases =
      m.aliases && m.aliases.length > 0
        ? ` _(alias: ${m.aliases.join(", ")})_`
        : "";
    return `${mark}\`${m.id}\` — ${m.displayName}${aliases}`;
  });

  if (models.length > 40) {
    lines.push(`_…and ${models.length - 40} more_`);
  }

  return [
    `*Available models* (current: \`${currentId}\`)`,
    ...lines,
    "",
    "Switch (works in threads): `model <id>` or `@PAI model <id>`",
    "Global default: `model global <id>`",
    "_Slack slash `/model` does not work inside threads._",
  ].join("\n");
}

export function matchModelId(
  requested: string,
  models: ModelListItem[],
): ModelListItem | undefined {
  const q = requested.trim().toLowerCase();
  return (
    models.find((m) => m.id.toLowerCase() === q) ??
    models.find((m) => m.aliases?.some((a) => a.toLowerCase() === q)) ??
    models.find((m) => m.displayName.toLowerCase() === q) ??
    models.find((m) => m.id.toLowerCase().includes(q))
  );
}
