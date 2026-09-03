# ---------------------------------------------------------------------------
# Cloud Scheduler job — triggers the Cloud Function every minute
#
# Uses OIDC authentication so the function can verify the caller identity
# without exposing the endpoint publicly beyond the IAM invoker binding.
#
# Note: the "schedule" below is the single source of truth for check cadence —
# there is no equivalent control in the Settings UI. Changing the cadence
# requires editing this value, updating SETTINGS.FIXED_INTERVAL_INFO in the
# three i18n files to match, and re-running `terraform apply` (or editing
# manually in Console).
#
# Timeout limit as N grows (see ADR 0007): a single invocation of
# check-internet-status (function.tf, timeout_seconds = 60) loops over every
# active household sequentially — the invocation count stays constant at
# ~1/minute regardless of N, but the per-invocation duration grows with N.
# Monitor the function's execution duration in Cloud Monitoring; when it
# approaches ~30s (half the timeout), revisit this design (parallelize the
# per-household loop within the invocation, or fan out via Pub/Sub, per the
# alternatives discussed in ADR 0007) rather than just raising timeout_seconds.
# ---------------------------------------------------------------------------

resource "google_cloud_scheduler_job" "check_internet_status" {
  name        = "check-internet-status"
  description = "Triggers the Cloud Function to check for recent heartbeat data"
  schedule    = "* * * * *"
  time_zone   = "America/Sao_Paulo"
  region      = var.region

  http_target {
    http_method = "POST"
    uri         = google_cloudfunctions2_function.check_internet_status.service_config[0].uri

    # OIDC token ensures Cloud Run (Gen 2 functions run on Cloud Run) accepts the request.
    oidc_token {
      service_account_email = var.sa_email
      audience              = google_cloudfunctions2_function.check_internet_status.service_config[0].uri
    }
  }
}
