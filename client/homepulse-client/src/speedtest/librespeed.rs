//! Speedtest provider backed by a self-hosted LibreSpeed backend
//! (<https://github.com/librespeed/speedtest>), reachable at
//! `config.librespeed_url`. Uses the standard LibreSpeed HTTP endpoints:
//! `garbage.php` (download), `empty.php` (upload), `ping.php` (latency).

use super::http_throughput::{
    build_client, measure_download_mbps, measure_ping_jitter_ms, measure_upload_mbps,
    ClientStrategy,
};
use super::{Provider, SpeedtestResult};
use crate::config::SpeedtestConfig;
use anyhow::{Context, Result};
use rand::RngCore;

/// Chunk size requested per `garbage.php` download GET, in the LibreSpeed
/// `ckSize` unit (roughly megabytes of generated payload).
const DOWNLOAD_CK_SIZE: u32 = 100;
/// Payload size sent per upload POST (4 MB).
const UPLOAD_BYTES: usize = 4_000_000;

pub struct LibreSpeedProvider;

#[async_trait::async_trait]
impl Provider for LibreSpeedProvider {
    async fn run(&self, config: &SpeedtestConfig) -> Result<SpeedtestResult> {
        let base_url = config
            .librespeed_url
            .as_deref()
            .map(|url| url.trim_end_matches('/'))
            .filter(|url| !url.is_empty())
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "provider = \"librespeed\" requires speedtest.librespeed_url in config.json"
                )
            })?;

        let timeout = std::time::Duration::from_secs(config.timeout_seconds);
        let ping_client = build_client(timeout).context("Failed to build HTTP client")?;

        let download_url = format!("{base_url}/garbage.php?ckSize={DOWNLOAD_CK_SIZE}");
        let upload_url = format!("{base_url}/empty.php");
        let ping_url = format!("{base_url}/ping.php");

        let (ping_ms, jitter_ms) = measure_ping_jitter_ms(&ping_client, &ping_url)
            .await
            .with_context(|| format!("LibreSpeed ping measurement failed ({base_url})"))?;
        let per_stream = ClientStrategy::PerStream(timeout);
        let download_mbps = measure_download_mbps(&per_stream, &download_url)
            .await
            .with_context(|| format!("LibreSpeed download measurement failed ({base_url})"))?;
        let upload_body = random_bytes(UPLOAD_BYTES);
        let upload_mbps = measure_upload_mbps(&per_stream, &upload_url, upload_body)
            .await
            .with_context(|| format!("LibreSpeed upload measurement failed ({base_url})"))?;

        Ok(SpeedtestResult {
            download_mbps,
            upload_mbps,
            ping_ms,
            jitter_ms,
            // Not measurable over HTTP; would require an ICMP-based backend.
            packet_loss_pct: 0.0,
            server: format!("LibreSpeed ({base_url})"),
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
