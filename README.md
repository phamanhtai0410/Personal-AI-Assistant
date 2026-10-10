# Personal AI Assistant

Slack Socket Mode gateway that drives a **Cursor local agent** (`@cursor/sdk`) on a always-on VPS. Cursor Pro provides the model + tool loop; this repo only handles messaging, sessions, memory vault, queueing, and ops.

```
Slack DM / @mention in channels → gateway (Node) → @cursor/sdk local → vault on disk
```

**Channels:** invite `@PAI`, then `@PAI …`. Follow-ups in that thread continue without another mention. Memory is split into workspace `MEMORY.md` and `channels/<id>/MEMORY.md`.

## Quick start (local)

```bash
cp .env.example .env
# fill CURSOR_API_KEY (or: npm run sdk-login), Slack tokens, SLACK_ALLOWED_USER_ID

npm ci
npm run spike          # Phase 0: prove local SDK works
npm test
npm run dev            # start Slack gateway
```

Phase 0 was verified on this machine with `@cursor/sdk` local `Agent.prompt` → `SPIKE_OK`. Re-run `npm run spike` on the Ubuntu VPS after deploy (same script).

Slash commands (register in the Slack app manifest; Socket Mode delivers them):

| Command   | Effect                                      |
|-----------|---------------------------------------------|
| Command (preferred in threads) | Effect |
|--------------------------------|--------|
| `new` / `@PAI new` | Clear Cursor agent for this conversation |
| `stop` / `@PAI stop` | Cancel the active run |
| `usage` / `@PAI usage` | Daily runs, tokens, agent usage, model |
| `models` / `@PAI models` | List Cursor models on your account |
| `model <id>` / `@PAI model <id>` | Switch model for this chat |
| `model global <id>` | Set workspace-wide default model |

**Threads:** Slack does **not** support slash commands (`/model`, `/models`, …) inside threads. Use plain text or `@PAI …` instead. Slash forms only work in the main DM/channel composer (and only if registered in the app manifest).

## Slack app

See [deploy/SLACK_SETUP.md](deploy/SLACK_SETUP.md). Manifest: [slack-app-manifest.yaml](slack-app-manifest.yaml).

## VPS deploy

```bash
# on the VPS as root
./deploy/setup-vps.sh

# from your laptop
rsync -az --exclude node_modules --exclude .git ./ pai@VPS:/opt/pai/
ssh pai@VPS 'cd /opt/pai && npm ci && npm run build && npm run spike'

# as root on VPS
cp /opt/pai/deploy/pai.service /etc/systemd/system/pai.service
# edit /etc/pai.env
systemctl daemon-reload && systemctl enable --now pai
journalctl -u pai -f
```

Backup (cron daily):

```bash
chmod +x /opt/pai/deploy/backup.sh
# e.g. 0 3 * * * PAI_DATA=/var/lib/pai /opt/pai/deploy/backup.sh
```

## Layout

| Path | Role |
|------|------|
| `src/` | Gateway, Slack, Cursor runtime, SQLite, scheduler |
| `vault/` | Durable memory (`MEMORY.md`, `USER.md`, skills) |
| `deploy/` | systemd unit, VPS setup, backup, Slack checklist |
| `scripts/spike-local.ts` | Phase 0 local SDK smoke test |

## Security

- Only `SLACK_ALLOWED_USER_ID` can talk to the bot.
- Secrets live in `/etc/pai.env` (mode `600`), never in git.
- Service runs as system user `pai` without sudo; agent tools inherit that user.
- `PAI_DAILY_RUN_CAP` brakes Pro usage spend.
