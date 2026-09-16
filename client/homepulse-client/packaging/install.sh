#!/usr/bin/env bash
# Installs homepulse-client as a systemd service on a Debian/Ubuntu (or any
# systemd-based Linux) host. Expects to be run from inside the extracted
# homepulse-client-linux-x86_64.tar.gz, alongside the `homepulse-client`
# binary and `homepulse-client.service` unit it installs.
#
# Usage:
#   ./install.sh <household_id> <api_key> <whoami_url> <heartbeat_url> <speedtest_url>
#
# household_id and api_key come from the Client screen. The three Cloud
# Function URLs are this deployment's endpoints — copy them from
# `terraform output` (see
# backend/homepulse-notification-server/terraform/outputs.tf: whoami_url,
# ingest_heartbeat_url, ingest_speedtest_url) or from another working
# config.json on the same deployment.
set -euo pipefail

HOUSEHOLD_ID="${1:?Usage: install.sh <household_id> <api_key> <whoami_url> <heartbeat_url> <speedtest_url>}"
API_KEY="${2:?Usage: install.sh <household_id> <api_key> <whoami_url> <heartbeat_url> <speedtest_url>}"
WHOAMI_URL="${3:?Usage: install.sh <household_id> <api_key> <whoami_url> <heartbeat_url> <speedtest_url>}"
HEARTBEAT_URL="${4:?Usage: install.sh <household_id> <api_key> <whoami_url> <heartbeat_url> <speedtest_url>}"
SPEEDTEST_URL="${5:?Usage: install.sh <household_id> <api_key> <whoami_url> <heartbeat_url> <speedtest_url>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing homepulse-client..."
install -m 755 "${SCRIPT_DIR}/homepulse-client" /usr/local/bin/homepulse-client

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
install -m 644 "${SCRIPT_DIR}/homepulse-client.service" /etc/systemd/system/homepulse-client.service
systemctl daemon-reload
systemctl enable --now homepulse-client.service

echo "Done. Check status with: systemctl status homepulse-client.service"
