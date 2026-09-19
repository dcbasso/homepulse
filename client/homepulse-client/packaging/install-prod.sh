#!/usr/bin/env bash
# Installs homepulse-client as a systemd service, pre-configured for the
# dcbasso HomePulse deployment (project speedtest-monitor-b5cd2). This is a
# convenience wrapper around install.sh with this deployment's endpoints
# hardcoded — use install.sh directly for any other deployment.
#
# Usage:
#   ./install-prod.sh -hh <household_id> -apikey <api_key>
#
# household_id and api_key come from the Client screen at
# https://speedtest-monitor-b5cd2.web.app/client.
set -euo pipefail

usage() {
  echo "Usage: install-prod.sh -hh <household_id> -apikey <api_key>" >&2
  exit 1
}

HOUSEHOLD_ID=""
API_KEY=""

while [ $# -gt 0 ]; do
  case "$1" in
    -hh)
      HOUSEHOLD_ID="${2:-}"
      shift 2
      ;;
    -apikey)
      API_KEY="${2:-}"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

[ -n "$HOUSEHOLD_ID" ] || usage
[ -n "$API_KEY" ] || usage

WHOAMI_URL="https://us-central1-speedtest-monitor-b5cd2.cloudfunctions.net/whoami"
HEARTBEAT_URL="https://southamerica-east1-speedtest-monitor-b5cd2.cloudfunctions.net/ingest-heartbeat"
SPEEDTEST_URL="https://southamerica-east1-speedtest-monitor-b5cd2.cloudfunctions.net/ingest-speedtest"
DOWNLOAD_URL="https://speedtest-monitor-b5cd2.web.app/downloads/homepulse-client-linux-x86_64"

echo "Downloading homepulse-client..."
curl -fL -o /tmp/homepulse-client "$DOWNLOAD_URL"
install -m 755 /tmp/homepulse-client /usr/local/bin/homepulse-client

echo "Writing /etc/homepulse-client/config.json..."
mkdir -p /etc/homepulse-client
cat > /etc/homepulse-client/config.json <<JSON
{
  "heartbeat": {
    "interval_minutes": 1,
    "whoami_url": "${WHOAMI_URL}"
  },
  "speedtest": {
    "binary_path": "speedtest",
    "timeout_seconds": 60,
    "interval_minutes": 60,
    "whoami_url": "${WHOAMI_URL}"
  },
  "ingest": {
    "api_key": "${API_KEY}",
    "household_id": "${HOUSEHOLD_ID}",
    "heartbeat_url": "${HEARTBEAT_URL}",
    "speedtest_url": "${SPEEDTEST_URL}"
  }
}
JSON
chmod 600 /etc/homepulse-client/config.json

echo "Installing systemd unit..."
cat > /etc/systemd/system/homepulse-client.service <<'UNIT'
[Unit]
Description=HomePulse client (heartbeat + speedtest reporting)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/homepulse-client --config /etc/homepulse-client/config.json
Restart=on-failure
RestartSec=5
DynamicUser=yes

[Install]
WantedBy=multi-user.target
UNIT
chmod 644 /etc/systemd/system/homepulse-client.service
systemctl daemon-reload
systemctl enable --now homepulse-client.service

echo "Done. Check status with: systemctl status homepulse-client.service"
