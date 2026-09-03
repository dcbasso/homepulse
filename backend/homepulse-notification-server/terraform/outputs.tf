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
