#!/usr/bin/env bash
# Run as root on a fresh Ubuntu 24.04 VPS.
set -euo pipefail

PAI_USER="${PAI_USER:-pai}"
PAI_HOME="/opt/pai"
PAI_DATA="/var/lib/pai"
NODE_MAJOR="${NODE_MAJOR:-22}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

apt-get update
apt-get install -y curl ca-certificates gnupg git rsync

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

id -u "$PAI_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$PAI_USER"

mkdir -p "$PAI_HOME" "$PAI_DATA/vault" "$PAI_DATA/data" /var/backups/pai
chown -R "$PAI_USER:$PAI_USER" "$PAI_HOME" "$PAI_DATA" /var/backups/pai

if [[ ! -f /etc/pai.env ]]; then
  cat >/etc/pai.env <<'EOF'
CURSOR_API_KEY=cursor_...
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_ALLOWED_USER_ID=U...
PAI_VAULT_DIR=/var/lib/pai/vault
PAI_DATA_DIR=/var/lib/pai/data
PAI_DB_PATH=/var/lib/pai/data/pai.db
PAI_MODEL_ID=composer-2
PAI_DAILY_RUN_CAP=40
PAI_BRIEFING_CRON=0 8 * * *
PAI_BRIEFING_ENABLED=true
PAI_TIMEZONE=Asia/Ho_Chi_Minh
# PAI_BRIEFING_CHANNEL=D...
EOF
  chmod 600 /etc/pai.env
  chown root:root /etc/pai.env
  echo "Created /etc/pai.env — fill in secrets before starting the service."
fi

# Ensure sqlite3 CLI exists for backups
apt-get install -y sqlite3

echo "Next:"
echo "  1. rsync this repo to $PAI_HOME (owned by $PAI_USER)"
echo "  2. cd $PAI_HOME && sudo -u $PAI_USER npm ci && sudo -u $PAI_USER npm run build"
echo "  3. Put CURSOR_API_KEY in /etc/pai.env, then:"
echo "       set -a; source /etc/pai.env; set +a"
echo "       sudo -E -u $PAI_USER npm run spike"
echo "  4. Finish Slack tokens + SLACK_ALLOWED_USER_ID in /etc/pai.env"
echo "  5. cp $PAI_HOME/deploy/pai.service /etc/systemd/system/pai.service"
echo "  6. cp $PAI_HOME/deploy/pai-backup.service $PAI_HOME/deploy/pai-backup.timer /etc/systemd/system/"
echo "  7. systemctl daemon-reload && systemctl enable --now pai pai-backup.timer"
echo "  8. journalctl -u pai -f"
