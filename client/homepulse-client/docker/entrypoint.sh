#!/bin/sh
set -eu

# Path inside the container where config.json is mounted.
CONFIG_PATH="${CONFIG_PATH:-/etc/homepulse/config.json}"

# The heartbeat and speedtest loops now run inside the binary itself
# (see src/main.rs), so this entrypoint just execs it once.
exec homepulse-client --config "$CONFIG_PATH"
