import { loadConfig } from "./config.js";
import { PaiDatabase } from "./db.js";
import { createCursorRuntime } from "./cursor-runtime.js";
import { Gateway } from "./gateway.js";
import { createSlackApp, registerSlackHandlers } from "./slack/app.js";
import { ensureVault } from "./vault.js";
import { startBriefingScheduler } from "./scheduler.js";

async function main(): Promise<void> {
  const config = loadConfig();
  await ensureVault(config.vaultDir);

  const db = new PaiDatabase(config.dbPath);
  const runtime = createCursorRuntime(config);
  const { app, poster } = createSlackApp(config);
  const gateway = new Gateway(config, db, runtime, poster);

  registerSlackHandlers(app, gateway);

  const stopScheduler = startBriefingScheduler({
    config,
    db,
    runtime,
    delivery: {
      post: async (channel, text) => {
        await poster.postMessage({ channel, text });
      },
    },
  });

  const shutdown = async (signal: string) => {
    console.log(`[pai] shutting down on ${signal}`);
    stopScheduler();
    await app.stop();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.start();
  console.log(
    `[pai] gateway online · vault=${config.vaultDir} · db=${config.dbPath} · model=${config.modelId}`,
  );
  console.log(
    `[pai] allowlist users=${config.slackAllowedUserIds.join(",")} · dailyCap=${config.dailyRunCap}`,
  );
  console.log(
    `[pai] channels: invite @PAI then @mention; thread follow-ups stay watched`,
  );
}

main().catch((err) => {
  console.error("[pai] fatal:", err);
  process.exit(1);
});
