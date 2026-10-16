#!/usr/bin/env bash
# Ships the committed code (git HEAD) to the droplet, installs dependencies, runs migrations and
# restarts the service. Run from the repo root on your PC (Git Bash):
#   deploy/deploy.sh root@203.0.113.10
# Uncommitted changes are not deployed. The previous release is kept at /opt/svu/app.previous.
set -euo pipefail

TARGET="${1:?Usage: deploy/deploy.sh root@<droplet-ip>}"
SSH="ssh ${SVU_SSH_OPTS:-}"
REV="$(git rev-parse --short HEAD)"
[[ -z "$(git status --porcelain)" ]] || echo "Note: uncommitted changes are not included; deploying $REV."

git archive --format=tar HEAD | $SSH "$TARGET" 'rm -rf /opt/svu/app.next && mkdir -p /opt/svu/app.next && tar -x -C /opt/svu/app.next'

$SSH "$TARGET" bash -s "$REV" <<'REMOTE'
set -euo pipefail
REV="$1"
cd /opt/svu/app.next
echo "$REV" > REVISION
mkdir -p data
chown -R svu:svu /opt/svu/app.next
sudo -u svu npm ci --omit=dev --no-audit --no-fund --loglevel=error
sudo -u svu bash -c 'set -a; . /etc/svu/svu.env; set +a; node scripts/migrate.js' > /tmp/svu-migrate.log || { cat /tmp/svu-migrate.log >&2; exit 1; }
grep -v '^Skipping' /tmp/svu-migrate.log || true
systemctl stop svu || true
rm -rf /opt/svu/app.previous
[[ -d /opt/svu/app ]] && mv /opt/svu/app /opt/svu/app.previous
mv /opt/svu/app.next /opt/svu/app
systemctl start svu
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:4173/api/health >/dev/null; then echo "Deployed $REV and healthy."; exit 0; fi
  sleep 1
done
echo "Service did not become healthy; recent log:" >&2
journalctl -u svu -n 40 --no-pager >&2
exit 1
REMOTE
