# homepulse

Home internet connection monitor — GCP implementation.

Runs a speedtest on a local machine on a schedule, stores results in Firestore, sends Gmail and/or Telegram alerts on outages, and exposes a web dashboard for historical analysis.

Project page: https://www.dantebasso.com.br/opensource/homepulse

## Monorepo Structure

| Path | Language | Description |
|---|---|---|
| [client/homepulse-client/](client/homepulse-client/) | Rust | Local agent — runs speedtest CLI and writes results to Firestore |
| [frontend/homepulse-web/](frontend/homepulse-web/) | Angular + TypeScript | Dashboard SPA hosted on Firebase Hosting |
| [backend/homepulse-notification-server/](backend/homepulse-notification-server/) | Python + Terraform | Cloud Function for alerting + GCP infrastructure |

## Architecture

```
[Local machine]                        [GCP / Firebase]
 client/homepulse-client (Rust)
  └─ runs speedtest CLI   ──────►  Firestore (speedtest_results)
                                        │
                               Cloud Scheduler (every N min)
                                        │
                    backend/homepulse-notification-server (Python)
                                        ├─ Gmail API      → alert / recovery email
                                        └─ Telegram Bot API → alert / recovery message
                                        │
                    frontend/homepulse-web (Angular)
                                        └─ Firebase Hosting
                                        └─ Firebase Auth (Google Sign-In)
                                        └─ reads Firestore directly (client SDK)
```

## Alert Channels

Outage/recovery notifications can be sent through two independent channels, both configurable per-recipient from the dashboard's Settings screen:

- **Gmail** — via the Gmail API, using an OAuth2 refresh token (see [Gmail OAuth](#gmail-oauth--publishing-status-gotcha) below).
- **Telegram** — via the Telegram Bot API. Each recipient stores a `bot_token` (from [@BotFather](https://t.me/BotFather)) and a `chat_id`. No OAuth or token refresh involved — a Telegram bot token doesn't expire, which makes it a good fallback for when the Gmail token gets stuck in "Testing" mode (see the gotcha below).

Recipients and channel toggles (`notify_telegram_on_down`, `notify_telegram_on_recovery`, etc.) are read from the monitor config document in Firestore; see [backend/homepulse-notification-server/function/main.py](backend/homepulse-notification-server/function/main.py) for the full alerting logic.

## Getting Started

See the setup guide in each subproject:

- [client/homepulse-client/](client/homepulse-client/) — Rust client setup and config
- [backend/homepulse-notification-server/function/](backend/homepulse-notification-server/function/) — Cloud Function deployment
- [backend/homepulse-notification-server/terraform/](backend/homepulse-notification-server/terraform/) — GCP infra provisioning
- [frontend/homepulse-web/](frontend/homepulse-web/) — Angular dashboard setup

## Registering a New Household (Admin)

There is no public self-signup — see [ADR 0005](docs/adr/0005-allowlist-administrada-manualmente-para-acesso.md). A new household is onboarded manually by the admin (the project operator):

1. **Create the household document** in Firestore (Console → `speedtest-monitordb-one` database, or `gcloud firestore`), matching the shape used by [`migrate_to_households.py`](backend/homepulse-notification-server/scripts/migrate_to_households.py) (see [ADR 0006](docs/adr/0006-firestore-security-rules-baseadas-em-membership-de-household.md)):
   ```
   households/{household_id}
     name: "Some Household"
     status: "active"
     api_keys: []
   ```
2. **Invite the owner** by creating an email-keyed member document — the app reconciles it to the real Firebase Auth UID on that user's first login (`HouseholdContextService.resolveMembershipsFor`/`claimMembership`):
   ```
   households/{household_id}/members/{owner_email}
     uid: ""
     email: "owner@example.com"
     role: "owner"
   ```
3. **Issue an ingest API key** for the household's `homepulse-client` instance:
   ```bash
   cd backend/homepulse-notification-server/scripts
   python3 issue_api_key.py --household-id <household_id> --label "home-server"
   ```
   Copy the printed key immediately — only its SHA-256 hash is stored, it cannot be recovered afterward.
4. **Configure the client** — copy `client/homepulse-client/config.json.example` to `config.json` and fill in `ingest.household_id` and `ingest.api_key` with the values from the steps above.
5. The owner signs in on the dashboard with the Google account matching the invited email — membership is claimed automatically, no further action needed.

To add more members to an existing household (not just the owner), repeat step 2 with `role: "member"` or `"admin"`.

## Gmail OAuth — Publishing Status Gotcha

The Cloud Function sends outage/recovery emails via the Gmail API using a long-lived OAuth2 refresh token stored in Secret Manager (`gmail-refresh-token`).

**The OAuth consent screen (GCP Console → APIs & Services → OAuth consent screen, aka "Google Auth Platform → Audience") must be in `In production` publishing status, not `Testing`.** While in `Testing`, Google expires refresh tokens after 7 days — this silently breaks email alerts while leaving other channels (e.g. Telegram) working, since they don't depend on this token. That mismatch is usually the first symptom anyone notices.

Symptom in Cloud Function logs: `Email down-alert failed: ('invalid_grant: Bad Request', ...)`.

**Fix once, permanently:** GCP Console → project → OAuth consent screen → set **Publishing status** to **"In production"** (click "Publish app"). The `gmail.send` scope is "sensitive" (not "restricted"), so a small/personal-use app can publish without Google verification — end users will just see an "unverified app" warning during consent, which is expected and safe to bypass ("Advanced" → "Go to (app) (unsafe)").

> **Gotcha #2 — the OAuth client must live in the same project as the Cloud Function.** If the OAuth client (and its consent screen) is created in a different GCP project than the one running `check-internet-status`, deleting that other project permanently destroys the client — no refresh token regeneration can fix it afterwards. Symptom in Cloud Function logs: `Email down-alert failed: ('deleted_client: The OAuth client was deleted.', ...)` (or, right after the source project is deleted but before the client record is purged, `... "Project #<number> has been deleted." ...`). If this happens, the client must be created from scratch (below) in the correct project — there is nothing to "regenerate".

### Creating the OAuth client from scratch (initial setup, or after Gotcha #2)

Needed once when setting up Gmail alerts for the first time, or again if the OAuth client itself was deleted (not just its refresh token — see Gotcha #2 above). Do these in order, inside the **same GCP project** that hosts the Cloud Function (the `project_id` from `terraform.tfvars`):

1. **Enable the Gmail API** — GCP Console → project → APIs & Services → Library → search "Gmail API" → Enable.
2. **Configure the OAuth consent screen** — GCP Console → project → "Google Auth Platform" → Audience/Overview → set up a new consent screen (External user type is fine for personal use), add the `https://www.googleapis.com/auth/gmail.send` scope, and set **Publishing status** to **"In production"** right away (skip "Testing" entirely to avoid Gotcha #1 above).
3. **Create the OAuth Client ID** — GCP Console → project → APIs & Services → Clients → Create Client → Application type **"Desktop app"**.
4. **Download the client credentials JSON** for the client just created, and save it as `client_secret.json` inside `backend/homepulse-notification-server/scripts/` (gitignored — never commit it).
5. Continue with "Regenerating the refresh token" below to obtain the refresh token and publish all three secrets.

**Regenerating the refresh token** (after the initial setup above, or whenever the token is revoked/expired but the client itself still exists — Gotcha #1):

1. Make sure `client_secret.json` for the current OAuth client is present in `backend/homepulse-notification-server/scripts/` (download it from GCP Console → APIs & Services → Clients if you don't already have it).
2. Install the OAuth flow dependency and run the helper script (committed at [backend/homepulse-notification-server/scripts/get_refresh_token.py](backend/homepulse-notification-server/scripts/get_refresh_token.py)):
   ```bash
   cd backend/homepulse-notification-server/scripts
   pip install --user google-auth-oauthlib
   python3 get_refresh_token.py
   ```
   A browser window opens — sign in with the alert-sending Google account and grant the `gmail.send` permission. The script prints the new `refresh_token`, `client_id`, and `client_secret`.
3. Store the values in Secret Manager. `gmail-refresh-token` always changes; only update `gmail-client-id`/`gmail-client-secret` if the OAuth client itself is new (e.g. after Gotcha #2) — they stay the same across a plain token regeneration:
   ```bash
   echo -n "NEW_REFRESH_TOKEN" | gcloud secrets versions add gmail-refresh-token --project=<PROJECT_ID> --data-file=-
   echo -n "NEW_CLIENT_ID"     | gcloud secrets versions add gmail-client-id     --project=<PROJECT_ID> --data-file=-
   echo -n "NEW_CLIENT_SECRET" | gcloud secrets versions add gmail-client-secret --project=<PROJECT_ID> --data-file=-
   ```
4. Force the Cloud Function to pick up the new values — secrets are injected as env vars only when a container instance starts, and the Gmail service is cached in memory per warm instance:
   ```bash
   gcloud functions deploy check-internet-status --project=<PROJECT_ID> --region=<REGION> \
     --source=backend/homepulse-notification-server/function \
     --update-secrets=GMAIL_REFRESH_TOKEN=gmail-refresh-token:latest,GMAIL_CLIENT_ID=gmail-client-id:latest,GMAIL_CLIENT_SECRET=gmail-client-secret:latest
   ```
