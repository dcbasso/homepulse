# Running homepulse-client natively

This covers installing the prebuilt binary directly on the host, without
Docker (see `docker/README.md` for the containerized alternative, Linux
only). `homepulse-client` is a single long-running process — its heartbeat
and speedtest loops run internally on the intervals configured in
`config.json`, so it only needs to be started once and supervised by the OS
(systemd on Linux, the Service Control Manager on Windows), not run on a
timer.

## Linux (systemd)

### 1. Get a household ID and API key

From the app's **Client** screen (as an owner/admin of the household), click
"Generate new API key". This issues a key in the form
`hpk_<household_id>_<random>` and shows it once — copy it immediately, it
cannot be recovered afterward. Alternatively, an operator with GCP access
can run `backend/homepulse-notification-server/scripts/issue_api_key.py`.

### 2. Download and extract the release

The Client screen resolves and links to the latest published Linux release,
`homepulse-client-linux-x86_64.tar.gz` (glibc, x86_64 only for now) —
bundling the `homepulse-client` binary, `install.sh`, and the
`homepulse-client.service` systemd unit together, so the archive is
self-contained:

```bash
curl -fL -o homepulse-client-linux-x86_64.tar.gz <download-url-from-the-Client-screen>
tar -xzf homepulse-client-linux-x86_64.tar.gz
cd <extracted-directory>
```

### 3. Run the installer

```bash
sudo ./install.sh <household_id> <api_key> <whoami_url> <heartbeat_url> <speedtest_url> <download_url>
```

This installs the binary to `/usr/local/bin/homepulse-client`, writes
`/etc/homepulse-client/config.json` with your household ID, the API key from
step 1, and this deployment's Cloud Function URLs (from `terraform output` —
see `backend/homepulse-notification-server/terraform/outputs.tf` for
`whoami_url`, `ingest_heartbeat_url`, `ingest_speedtest_url`), and installs +
enables the `homepulse-client.service` systemd unit. See
`config.json.example` in this directory for the config's full shape.

### 4. Verify the service

```bash
sudo systemctl status homepulse-client.service
```

Stopping the service (`systemctl stop`) sends `SIGTERM`; the client responds
by finishing the current loop iteration and exiting cleanly instead of being
killed mid-tick.

## Windows

`homepulse-client.exe` registers itself as a native Windows Service (see
[ADR 0011](../../docs/adr/0011-windows-service-nativo-para-o-client-usando-windows-service.md))
via its own `install`/`uninstall`/`start`/`stop` subcommands — there is no
separate service wrapper to install.

### 1. Get a household ID and API key

Same as the Linux flow above.

### 2. Install the service

Download `homepulse-client-windows-x86_64.zip` from the Client screen's
Windows release asset (bundles `homepulse-client.exe` and the
`packaging/windows/*.ps1` scripts) and extract it. From an **elevated**
PowerShell prompt:

```powershell
.\install.ps1 -HouseholdId <household_id> -ApiKey <api_key> `
    -WhoamiUrl <whoami_url> -HeartbeatUrl <heartbeat_url> -SpeedtestUrl <speedtest_url>
```

This writes `%ProgramData%\homepulse-client\config.json` and registers +
starts the `HomePulseClient` service (auto-start on boot). The [Ookla
speedtest CLI](https://www.speedtest.net/apps/cli) must be installed
separately and available on `PATH` as `speedtest.exe`.

### 3. Verify and manage the service

```powershell
Get-Service HomePulseClient
Stop-Service HomePulseClient
Start-Service HomePulseClient
```

Logs go to the Windows Event Log (Event Viewer → Windows Logs → Application,
source `HomePulseClient`), not to a file.

### 4. Uninstall

```powershell
.\uninstall.ps1
```

Keeps `%ProgramData%\homepulse-client\config.json` (and the API key in it)
by default; pass `-RemoveConfig` to delete it too.
