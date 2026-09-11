# Running homepulse-client natively (systemd)

This covers installing the prebuilt Linux binary directly on the host,
without Docker (see `docker/README.md` for the containerized alternative).
`homepulse-client` is a single long-running process — its heartbeat and
speedtest loops run internally on the intervals configured in `config.json`,
so it only needs to be started once and supervised by systemd, not run on a
timer.

## 1. Get a household ID and API key

From the app's **Client** screen (as an owner/admin of the household), click
"Generate new API key". This issues a key in the form
`hpk_<household_id>_<random>` and shows it once — copy it immediately, it
cannot be recovered afterward. Alternatively, an operator with GCP access
can run `backend/homepulse-notification-server/scripts/issue_api_key.py`.

## 2. Download the binary

The Client screen resolves and links to the latest published Linux release
(`homepulse-client-linux-x86_64`, glibc, x86_64 only for now). Download it
and make it executable:

```bash
curl -fL -o homepulse-client <download-url-from-the-Client-screen>
chmod +x homepulse-client
sudo install -m 755 homepulse-client /usr/local/bin/homepulse-client
```

## 3. Write the config file

Create `/etc/homepulse-client/config.json` with your household ID, the API
key from step 1, and this deployment's Cloud Function URLs (from
`terraform output` — see `backend/homepulse-notification-server/terraform/outputs.tf`
for `whoami_url`, `ingest_heartbeat_url`, `ingest_speedtest_url`). See
`config.json.example` in this directory for the full shape.

## 4. Install the systemd service

```bash
sudo install -m 644 packaging/homepulse-client.service /etc/systemd/system/homepulse-client.service
sudo systemctl daemon-reload
sudo systemctl enable --now homepulse-client.service
sudo systemctl status homepulse-client.service
```

`packaging/install.sh` scripts steps 2-4 together — run it with
`<household_id> <api_key> <whoami_url> <heartbeat_url> <speedtest_url> <download_url>`.
