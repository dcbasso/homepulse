# ---------------------------------------------------------------------------
# Secret Manager — data sources (read-only)
#
# These secrets are created MANUALLY during the pre-requisites step
# (see gcp/docs/pre-requisites.md). Terraform only reads their metadata
# so it can reference them in the Cloud Function's secret env vars.
#
# Never manage the secret values themselves via Terraform — doing so would
# store plaintext credentials in the Terraform state file.
# ---------------------------------------------------------------------------

# gmail-client-id — OAuth2 client ID for Gmail API access
data "google_secret_manager_secret" "gmail_client_id" {
  secret_id = "gmail-client-id"
}

# gmail-client-secret — OAuth2 client secret for Gmail API access
data "google_secret_manager_secret" "gmail_client_secret" {
  secret_id = "gmail-client-secret"
}

# gmail-refresh-token — long-lived OAuth2 refresh token obtained during
# the one-time consent flow (see gcp/docs/pre-requisites.md)
data "google_secret_manager_secret" "gmail_refresh_token" {
  secret_id = "gmail-refresh-token"
}
