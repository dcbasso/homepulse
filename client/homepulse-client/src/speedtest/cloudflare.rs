//! Speedtest provider backed by Cloudflare's public speed test endpoints
//! (`speed.cloudflare.com`) — the same endpoints used by tools such as
//! `cfspeedtest`. No account, server selection, or self-hosting required.

use super::http_throughput::{
    build_client, measure_download_mbps, measure_ping_jitter_ms, measure_upload_mbps,
    ClientStrategy,
};
use super::{Provider, SpeedtestResult};
use crate::config::SpeedtestConfig;
use anyhow::{Context, Result};
use rand::RngCore;

const BASE_URL: &str = "https://speed.cloudflare.com";
/// Payload size requested per download GET (25 MB).
const DOWNLOAD_BYTES: u64 = 25_000_000;
/// Payload size sent per upload POST (4 MB).
const UPLOAD_BYTES: usize = 4_000_000;

pub struct CloudflareProvider;

#[async_trait::async_trait]
impl Provider for CloudflareProvider {
    async fn run(&self, config: &SpeedtestConfig) -> Result<SpeedtestResult> {
        let timeout = std::time::Duration::from_secs(config.timeout_seconds);
        let ping_client = build_client(timeout).context("Failed to build HTTP client")?;

        let download_url = format!("{BASE_URL}/__down?bytes={DOWNLOAD_BYTES}");
        let upload_url = format!("{BASE_URL}/__up");
        let ping_url = format!("{BASE_URL}/__down?bytes=0");

        let (ping_ms, jitter_ms) = measure_ping_jitter_ms(&ping_client, &ping_url)
            .await
            .context("Cloudflare ping measurement failed")?;
        let per_stream = ClientStrategy::PerStream(timeout);
        let download_mbps = measure_download_mbps(&per_stream, &download_url)
            .await
            .context("Cloudflare download measurement failed")?;
        let upload_body = random_bytes(UPLOAD_BYTES);
        let upload_mbps = measure_upload_mbps(&per_stream, &upload_url, upload_body)
            .await
            .context("Cloudflare upload measurement failed")?;

        Ok(SpeedtestResult {
            download_mbps,
            upload_mbps,
            ping_ms,
            jitter_ms,
            // Not measurable over HTTP; Cloudflare's endpoint gives no signal for it.
            packet_loss_pct: 0.0,
            server: "Cloudflare (speed.cloudflare.com)".to_string(),
            isp: "unknown".to_string(),
            external_ip_v4: None,
            external_ip_v6: None,
            result_url: String::new(),
        })
    }
}

/// Generates `len` random bytes to use as an upload body.
fn random_bytes(len: usize) -> bytes::Bytes {
    let mut buf = vec![0u8; len];
    rand::rng().fill_bytes(&mut buf);
    bytes::Bytes::from(buf)
}
