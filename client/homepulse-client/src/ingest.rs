use crate::config::IngestConfig;
use crate::speedtest::SpeedtestResult;
use anyhow::{bail, Context, Result};

/// Placeholder sent to the Ingest API when an IP lookup (v4 or v6) failed.
const UNKNOWN_IP: &str = "unknown";

/// Sends a speedtest result to the `ingest-speedtest` Cloud Function.
///
/// Authenticates with the household's API key instead of a GCP Service
/// Account credential (ADR 0004). The server resolves the household and
/// assigns the document timestamp; no `timestamp` field is sent.
///
/// # Arguments
/// * `config` - Ingest API connection settings (API key, speedtest endpoint URL).
/// * `result` - Parsed speedtest measurement to persist.
///
/// # Errors
/// Returns an error if the HTTP request fails or the Ingest API rejects the payload.
pub async fn append_document(config: &IngestConfig, result: &SpeedtestResult) -> Result<()> {
    let body = serde_json::json!({
        "download_mbps": result.download_mbps,
        "upload_mbps": result.upload_mbps,
        "ping_ms": result.ping_ms,
        "jitter_ms": result.jitter_ms,
        "packet_loss_pct": result.packet_loss_pct,
        "server": result.server,
        "isp": result.isp,
        "external_ip_v4": result.external_ip_v4.as_deref().unwrap_or(UNKNOWN_IP),
        "external_ip_v6": result.external_ip_v6.as_deref().unwrap_or(UNKNOWN_IP),
        "result_url": result.result_url
    });

    post(&config.speedtest_url, &config.api_key, &body).await
}

/// Sends a liveness heartbeat to the `ingest-heartbeat` Cloud Function.
///
/// Mirrors [`append_document`] but with a minimal body (`external_ip_v4` and
/// `external_ip_v6` only), since the heartbeat only needs to prove
/// connectivity, not carry a full speedtest measurement.
///
/// # Arguments
/// * `config` - Ingest API connection settings (API key, heartbeat endpoint URL).
/// * `external_ip_v4` - Public IPv4 resolved via the `whoami` endpoint, or `None` if that lookup failed.
/// * `external_ip_v6` - Public IPv6 resolved via the `whoami` endpoint, or `None` if that lookup failed.
///   A failed IP lookup must not prevent the heartbeat write, so `"unknown"` is sent instead.
///
/// # Errors
/// Returns an error if the HTTP request fails or the Ingest API rejects the payload.
pub async fn append_heartbeat(
    config: &IngestConfig,
    external_ip_v4: Option<&str>,
    external_ip_v6: Option<&str>,
) -> Result<()> {
    let body = serde_json::json!({
        "external_ip_v4": external_ip_v4.unwrap_or(UNKNOWN_IP),
        "external_ip_v6": external_ip_v6.unwrap_or(UNKNOWN_IP)
    });

    post(&config.heartbeat_url, &config.api_key, &body).await
}

/// Posts a JSON body to the Ingest API, authenticated with the household's API key.
///
/// # Arguments
/// * `url` - Full URL of the Ingest API endpoint to call.
/// * `api_key` - Raw API key, sent as `Authorization: ApiKey <api_key>`.
/// * `body` - JSON payload to send.
///
/// # Errors
/// Returns an error if the HTTP request fails or the endpoint returns a non-2xx status.
async fn post(url: &str, api_key: &str, body: &serde_json::Value) -> Result<()> {
    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .header("Authorization", format!("ApiKey {}", api_key))
        .json(body)
        .send()
        .await
        .context("Failed to call the Ingest API")?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        bail!("Ingest API returned an error ({}): {}", status, body);
    }

    Ok(())
}
