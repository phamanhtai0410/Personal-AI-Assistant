# Slack app setup (manual)

1. Create a free Slack workspace (or use an existing personal one).
2. Go to [https://api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest**.
3. Paste [`slack-app-manifest.yaml`](../slack-app-manifest.yaml).
4. **Socket Mode** → Enable → generate an **App-Level Token** with scope `connections:write`. Copy as `SLACK_APP_TOKEN` (`xapp-...`).
5. **OAuth & Permissions** → **Install to Workspace** → copy **Bot User OAuth Token** as `SLACK_BOT_TOKEN` (`xoxb-...`).
6. Open a DM with the bot. In Slack, click your profile → **Copy member ID** → set `SLACK_ALLOWED_USER_ID`.
7. After the first DM, copy the DM channel id (starts with `D`) into `PAI_BRIEFING_CHANNEL` for morning briefings.
8. Put all values into `.env` (Mac) or `/etc/pai.env` on the VPS (mode `600`).

## Commands (`new`, `models`, …)

**Prefer plain text or `@PAI …`.** Slack does not support slash commands inside threads (`/model is not supported in threads`).

In a watched thread you can type just:

```text
models
model composer-2
usage
```

Or `@PAI models` / `@PAI model composer-2`.

Optional slash commands (`/new`, `/stop`, `/usage`, `/models`, `/model`) only work in the main channel/DM input after they are registered — not in threads.

Slack treats leading `/` as workspace slash commands. They never reach the bot as normal messages unless registered.

### If the app already exists

1. Open the app → **App Manifest** → paste the updated [`slack-app-manifest.yaml`](../slack-app-manifest.yaml) → **Save Changes**.
2. Or manually: **Features → Slash Commands → Create New Command** for `/new`, `/stop`, `/usage` (Socket Mode: leave Request URL empty).
3. **OAuth & Permissions → Reinstall to Workspace** if Slack prompts.
4. Restart the gateway (`Ctrl+C` then `npm run dev`).

### Without re-registering (quick local workaround)

In the DM, type plain text instead of slash:

- `new` or `!new`
- `stop` or `!stop`
- `usage` or `!usage`

## Multi-channel (workspace)

1. Update the app manifest (adds `channels:read`, `groups:read`) → **Save** → **Reinstall to Workspace**.
2. In each channel where you want PAI: `/invite @PAI`
3. Talk to it with `@PAI …` (or reply in the thread it opens). Bare channel chatter is ignored so Cursor runs are not burned.
4. Memory:
   - Workspace: `vault/MEMORY.md`
   - Per channel: `vault/channels/<channelId>/MEMORY.md`

DM behavior is unchanged (every message from an allowlisted user).
