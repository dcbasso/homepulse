#!/usr/bin/env bash
# Installs homepulse-client as a systemd service on a Debian/Ubuntu (or any
# systemd-based Linux) host.
#
# Usage:
#   ./install.sh <household_id> <api_key> <whoami_url> <heartbeat_url> <speedtest_url> <download_url>
#
# household_id, api_key, and download_url come from the Client screen (the
# app resolves download_url dynamically to the latest published client-v*
# GitHub release — do not hardcode `releases/latest`, which resolves to the
# monorepo's own version tags instead). The three Cloud Function URLs are
# this deployment's endpoints — copy them from `terraform output` (see
# backend/homepulse-notification-server/terraform/outputs.tf: whoami_url,
# ingest_heartbeat_url, ingest_speedtest_url) or from another working
# config.json on the same deployment.
set -euo pipefail

HOUSEHOLD_ID="${1:?Usage: install.sh <household_id> <api_key> <whoami_url> <heartbeat_url> <speedtest_url> <download_url>}"
API_KEY="${2:?Usage: install.sh <household_id> <api_key> <whoami_url> <heartbeat_url> <speedtest_url> <download_url>}"
WHOAMI_URL="${3:?Usage: install.sh <household_id> <api_key> <whoami_url> <heartbeat_url> <speedtest_url> <download_url>}"
HEARTBEAT_URL="${4:?Usage: install.sh <household_id> <api_key> <whoami_url> <heartbeat_url> <speedtest_url> <download_url>}"
SPEEDTEST_URL="${5:?Usage: install.sh <household_id> <api_key> <whoami_url> <heartbeat_url> <speedtest_url> <download_url>}"
DOWNLOAD_URL="${6:?Usage: install.sh <household_id> <api_key> <whoami_url> <heartbeat_url> <speedtest_url> <download_url>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
    "provider": "cloudflare",
    "librespeed_url": null,
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
install -m 644 "${SCRIPT_DIR}/homepulse-client.service" /etc/systemd/system/homepulse-client.service
systemctl daemon-reload
systemctl enable --now homepulse-client.service

echo "Done. Check status with: systemctl status homepulse-client.service"
