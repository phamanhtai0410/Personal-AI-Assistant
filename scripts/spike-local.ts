/**
 * Phase 0 spike: prove @cursor/sdk local Agent.prompt works on this host.
 *
 * Usage:
 *   CURSOR_API_KEY=... npx tsx scripts/spike-local.ts
 *
 * Exit codes:
 *   0 — finished successfully
 *   1 — startup / auth / config failure
 *   2 — agent ran but result.status !== "finished"
 *   3 — local runtime unavailable; fall back to Cloud Agent + git vault
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Agent, Cursor, CursorAgentError } from "@cursor/sdk";

async function main(): Promise<void> {
  const cwd = join(process.cwd(), "spike-cwd");
  await mkdir(cwd, { recursive: true });
  await writeFile(
    join(cwd, "AGENTS.md"),
    "# Spike vault\nReply in one short sentence.\n",
    "utf8",
  );

  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (apiKey) {
    console.log("[spike] using CURSOR_API_KEY from env");
  } else {
    const status = await Cursor.auth.status();
    console.log("[spike] Cursor.auth.status:", status.status);
    if (status.status !== "logged-in") {
      console.error(
        "[spike] No CURSOR_API_KEY and Cursor.auth is not logged in.\n" +
          "Mint a key at https://cursor.com/dashboard/cloud-agents or run Cursor.auth.login().",
      );
      process.exit(1);
    }
  }

  const modelId = process.env.PAI_MODEL_ID ?? "composer-2";
  console.log(`[spike] cwd=${cwd} model=${modelId}`);

  try {
    const result = await Agent.prompt(
      "Read AGENTS.md in the working directory and reply with exactly: SPIKE_OK",
      {
        ...(apiKey ? { apiKey } : {}),
        model: { id: modelId },
        local: { cwd, settingSources: ["project"] },
      },
    );

    console.log(`[spike] status=${result.status}`);
    console.log(`[spike] result=${result.result ?? "(empty)"}`);
    if (result.status !== "finished") {
      process.exit(2);
    }
    console.log("[spike] SUCCESS — local runtime is usable");
    process.exit(0);
  } catch (err) {
    if (err instanceof CursorAgentError) {
      console.error(
        `[spike] CursorAgentError: ${err.message} retryable=${err.isRetryable}`,
      );
      if (/plan_required|not available|headless|ENOENT|spawn/i.test(err.message)) {
        console.error(
          "[spike] Local runtime appears unavailable. Fall back to Cloud Agent + git vault per plan option 1B.",
        );
        process.exit(3);
      }
      process.exit(1);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error("[spike] unexpected:", err);
  process.exit(1);
});
