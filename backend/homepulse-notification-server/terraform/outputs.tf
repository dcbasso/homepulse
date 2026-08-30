# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

output "whoami_url" {
  description = "Public URL of the whoami Cloud Function. Copy into the Rust client's config.json under heartbeat.whoami_url."
  value       = google_cloudfunctions2_function.whoami.service_config[0].uri
}
