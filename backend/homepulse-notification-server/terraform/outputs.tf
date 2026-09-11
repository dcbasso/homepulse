# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

output "whoami_url" {
  description = "Public URL of the whoami Cloud Function. Copy into the Rust client's config.json under heartbeat.whoami_url."
  value       = google_cloudfunctions2_function.whoami.service_config[0].uri
}

output "ingest_heartbeat_url" {
  description = "Public URL of the ingest-heartbeat Cloud Function. Copy into the Rust client's config.json ingest settings (Fase 3)."
  value       = google_cloudfunctions2_function.ingest_heartbeat.service_config[0].uri
}

output "ingest_speedtest_url" {
  description = "Public URL of the ingest-speedtest Cloud Function. Copy into the Rust client's config.json ingest settings (Fase 3)."
  value       = google_cloudfunctions2_function.ingest_speedtest.service_config[0].uri
}

output "send_invite_email_url" {
  description = "Public URL of the send-invite-email Cloud Function. Copy into the frontend's environment.ts/environment.prod.ts as inviteFunctionUrl."
  value       = google_cloudfunctions2_function.send_invite_email.service_config[0].uri
}

output "issue_api_key_url" {
  description = "Public URL of the issue-api-key Cloud Function. Copy into the frontend's environment.ts/environment.prod.ts as issueApiKeyFunctionUrl."
  value       = google_cloudfunctions2_function.issue_api_key.service_config[0].uri
}
