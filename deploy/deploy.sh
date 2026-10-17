#!/usr/bin/env bash
# Ships the committed code (git HEAD) to the droplet, installs dependencies, runs migrations and
# restarts the service. Run from the repo root on your PC (Git Bash):
#   deploy/deploy.sh root@203.0.113.10
# Uncommitted changes are not deployed. The previous release is kept at /opt/svu/app.previous.
set -euo pipefail

TARGET="${1:?Usage: deploy/deploy.sh root@<droplet-ip>}"
LEGACY_ACADEMICS="${2:-}"
[[ -z "$LEGACY_ACADEMICS" || "$LEGACY_ACADEMICS" == --legacy-academics ]] || { echo 'Unknown deployment option' >&2; exit 1; }
SSH="ssh ${SVU_SSH_OPTS:-}"
REV="$(git rev-parse --short HEAD)"
[[ -z "$(git status --porcelain)" ]] || echo "Note: uncommitted changes are not included; deploying $REV."

git archive --format=tar HEAD | $SSH "$TARGET" 'rm -rf /opt/svu/app.next && mkdir -p /opt/svu/app.next && tar -x -C /opt/svu/app.next'

$SSH "$TARGET" bash -s "$REV" "$LEGACY_ACADEMICS" <<'REMOTE'
set -euo pipefail
REV="$1"
LEGACY_ACADEMICS="${2:-}"
umask 077
mkdir -p /var/backups/svu /opt/svu/shared/data
sudo -u postgres pg_dump -Fc svu_rebuild > "/var/backups/svu/svu_rebuild-pre-$REV-$(date -u +%Y%m%dT%H%M%SZ).dump"
# Keep uploads and the legacy archive key across release-directory swaps.
if [[ -d /opt/svu/app/data && ! -L /opt/svu/app/data ]]; then
  cp -an /opt/svu/app/data/. /opt/svu/shared/data/
fi
chown -R svu:svu /opt/svu/shared
cd /opt/svu/app.next
echo "$REV" > REVISION
ln -s /opt/svu/shared/data data
chown -R svu:svu /opt/svu/app.next
sudo -u svu npm ci --omit=dev --no-audit --no-fund --loglevel=error
sudo -u svu bash -c 'set -a; . /etc/svu/svu.env; set +a; node scripts/migrate.js' > /tmp/svu-migrate.log || { cat /tmp/svu-migrate.log >&2; exit 1; }
grep -v '^Skipping' /tmp/svu-migrate.log || true
if [[ "$LEGACY_ACADEMICS" == --legacy-academics ]]; then
  sudo -u svu bash -c 'set -a; . /etc/svu/svu.env; set +a; node scripts/link-legacy-academic-records.js --apply'
fi
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
systemctl stop svu || true
mv /opt/svu/app /opt/svu/app.failed
mv /opt/svu/app.previous /opt/svu/app
systemctl start svu
echo 'Restored the previous application release; database backup retained.' >&2
exit 1
REMOTE
