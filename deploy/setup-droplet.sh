#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 24.04 droplet for SVU. Run as root:
#   bash setup-droplet.sh svu.example.edu
# Installs Node 22, PostgreSQL 16 and Caddy (automatic HTTPS), creates the svu user, database,
# /etc/svu/svu.env with a generated data key, the systemd service and the firewall rules.
# Safe to re-run: existing secrets, database and env file are kept.
set -euo pipefail

DOMAIN="${1:?Usage: setup-droplet.sh <domain>}"
APP_DIR=/opt/svu/app
ENV_FILE=/etc/svu/svu.env

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq ca-certificates curl gnupg ufw postgresql debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [[ "$(node -v)" != v22.* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -yq nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -yq caddy
fi

# Small droplets run out of memory during npm ci without swap.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

id svu >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/svu --shell /usr/sbin/nologin svu
mkdir -p "$APP_DIR" /etc/svu /var/backups/svu
chown svu:svu /opt/svu "$APP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  DB_PASSWORD="$(openssl rand -hex 24)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
create role svu login password '$DB_PASSWORD';
create database svu_rebuild owner svu;
SQL
  cat > "$ENV_FILE" <<ENV
SVU_APP_NAME="South Valley University"
SVU_ENV=production
NODE_ENV=production
SVU_HOST=127.0.0.1
SVU_PORT=4173
DATABASE_URL=postgres://svu:$DB_PASSWORD@127.0.0.1:5432/svu_rebuild
# Encrypts secrets at rest and signs document links. Back this up: losing it makes stored secrets unreadable.
SVU_DATA_KEY=$(openssl rand -base64 32)
SVU_MFA_POLICY=privileged
ENV
  chown root:svu "$ENV_FILE"
  chmod 640 "$ENV_FILE"
fi

cat > /etc/systemd/system/svu.service <<'UNIT'
[Unit]
Description=South Valley University
After=network.target postgresql.service
Requires=postgresql.service

[Service]
User=svu
Group=svu
WorkingDirectory=/opt/svu/app
EnvironmentFile=/etc/svu/svu.env
ExecStart=/usr/bin/node server/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/svu/app/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable svu >/dev/null

cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:4173
}
CADDY
systemctl reload caddy || systemctl restart caddy

# Nightly database dump, 14 days kept.
cat > /etc/cron.daily/svu-backup <<'CRON'
#!/bin/sh
sudo -u postgres pg_dump -Fc svu_rebuild > /var/backups/svu/svu_rebuild-$(date +%F).dump
find /var/backups/svu -name '*.dump' -mtime +14 -delete
CRON
chmod 755 /etc/cron.daily/svu-backup

ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "Droplet ready for $DOMAIN. Next: deploy the code with deploy/deploy.sh from your PC."
