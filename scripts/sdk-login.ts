import { Cursor } from "@cursor/sdk";

async function main(): Promise<void> {
  console.log("[auth] opening browser for Cursor.auth.login()…");
  const result = await Cursor.auth.login();
  console.log("[auth] logged in as", result.email ?? "(unknown email)");
  console.log("[auth] key expires at", result.apiKeyExpiresAtMs);
  const status = await Cursor.auth.status();
  console.log("[auth] status:", status);
}

main().catch((err) => {
  console.error("[auth] failed:", err);
  process.exit(1);
});
