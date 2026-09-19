//! Speedtest provider that speaks the speedtest.net (Ookla) "Mini" server
//! protocol directly over HTTP — the same protocol the official `speedtest`
//! CLI used, reimplemented here without any external binary or crate.
//!
//! Unlike a thin wrapper around a third-party client library, this
//! implementation tries multiple candidate servers (nearest first) and
//! falls back to the next one on any failure. Ookla's publicly listed
//! "Mini" servers are self-hosted by individual ISPs and are frequently
//! flaky or offline; a single fixed "best" server with no fallback (as
//! third-party Ookla client libraries typically do) fails outright whenever
//! that one server is down.

use super::http_throughput::{
    measure_download_mbps, measure_ping_jitter_ms, measure_upload_mbps, ClientStrategy,
};
use super::{Provider, SpeedtestResult};
use crate::config::SpeedtestConfig;
use anyhow::{anyhow, Context, Result};
use rand::RngCore;
use reqwest::Client;
use serde::Deserialize;

const SERVERS_URL: &str = "https://www.speedtest.net/speedtest-servers-static.php";
const CONFIG_URL: &str = "https://www.speedtest.net/api/ios-config.php";
/// How many nearest servers to try before giving up.
const MAX_CANDIDATES: usize = 5;
/// Payload size sent per upload POST (4 MB).
const UPLOAD_BYTES: usize = 4_000_000;
/// Download test asset requested from each server (speedtest.net Mini
/// servers serve a fixed set of pre-generated JPEG files for this purpose).
const DOWNLOAD_ASSET: &str = "random4000x4000.jpg";

pub struct OoklaProvider;

#[async_trait::async_trait]
impl Provider for OoklaProvider {
    async fn run(&self, config: &SpeedtestConfig) -> Result<SpeedtestResult> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(config.timeout_seconds))
            .build()
            .context("Failed to build HTTP client")?;

        let mut servers = fetch_servers(&client)
            .await
            .context("Failed to fetch the speedtest.net server list")?;
        if servers.is_empty() {
            anyhow::bail!("speedtest.net returned an empty server list");
        }

        if let Ok(location) = fetch_client_location(&client).await {
            servers.sort_by(|a, b| {
                distance_km(location, (a.lat, a.lon))
                    .partial_cmp(&distance_km(location, (b.lat, b.lon)))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
        }

        let mut last_err: Option<anyhow::Error> = None;
        for server in servers.iter().take(MAX_CANDIDATES) {
            match measure_against_server(&client, server).await {
                Ok(result) => return Ok(result),
                Err(e) => last_err = Some(e),
            }
        }

        Err(last_err.unwrap_or_else(|| anyhow!("no candidate servers were available")))
            .context("All candidate speedtest.net servers failed")
    }
}

/// A speedtest.net "Mini" server, as listed in the static server feed.
#[derive(Debug, Clone, Deserialize)]
struct ServerEntry {
    #[serde(rename = "@url")]
    url: String,
    #[serde(rename = "@name")]
    name: String,
    #[serde(rename = "@sponsor")]
    sponsor: String,
    #[serde(rename = "@country")]
    country: String,
    #[serde(rename = "@lat")]
    lat: f64,
    #[serde(rename = "@lon")]
    lon: f64,
}

#[derive(Debug, Deserialize)]
struct ServersWrapper {
    #[serde(rename = "server", default)]
    server: Vec<ServerEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename = "settings")]
struct ServerListXml {
    servers: ServersWrapper,
}

/// Fetches the full list of speedtest.net "Mini" servers.
async fn fetch_servers(client: &Client) -> Result<Vec<ServerEntry>> {
    let body = client
        .get(SERVERS_URL)
        .send()
        .await
        .context("request to speedtest-servers-static.php failed")?
        .text()
        .await
        .context("failed to read server list response body")?;
    let parsed: ServerListXml =
        quick_xml::de::from_str(&body).context("failed to parse server list XML")?;
    Ok(parsed.servers.server)
}

#[derive(Debug, Default, Deserialize)]
struct ClientEntry {
    #[serde(rename = "@lat", default)]
    lat: Option<f64>,
    #[serde(rename = "@lon", default)]
    lon: Option<f64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename = "settings")]
struct ClientConfigXml {
    #[serde(default)]
    client: ClientEntry,
}

/// Fetches the caller's approximate geographic location (used only to order
/// candidate servers nearest-first). Returns an error if unavailable; the
/// caller falls back to trying servers in the order speedtest.net listed
/// them.
async fn fetch_client_location(client: &Client) -> Result<(f64, f64)> {
    let body = client
        .get(CONFIG_URL)
        .send()
        .await
        .context("request to ios-config.php failed")?
        .text()
        .await
        .context("failed to read client config response body")?;
    let parsed: ClientConfigXml =
        quick_xml::de::from_str(&body).context("failed to parse client config XML")?;
    Ok((
        parsed.client.lat.context("missing client latitude")?,
        parsed.client.lon.context("missing client longitude")?,
    ))
}

/// Great-circle distance between two `(lat, lon)` points in kilometers
/// (Haversine formula).
fn distance_km(a: (f64, f64), b: (f64, f64)) -> f64 {
    const EARTH_RADIUS_KM: f64 = 6371.0;
    let (lat1, lon1) = (a.0.to_radians(), a.1.to_radians());
    let (lat2, lon2) = (b.0.to_radians(), b.1.to_radians());
    let delta_lat = lat2 - lat1;
    let delta_lon = lon2 - lon1;
    let h = (delta_lat / 2.0).sin().powi(2)
        + lat1.cos() * lat2.cos() * (delta_lon / 2.0).sin().powi(2);
    EARTH_RADIUS_KM * 2.0 * h.sqrt().atan2((1.0 - h).sqrt())
}

/// Derives the server's asset base directory from its published upload URL
/// (`.../upload.php`).
fn base_url(server_url: &str) -> &str {
    server_url
        .trim_end_matches('/')
        .strip_suffix("/upload.php")
        .unwrap_or_else(|| server_url.trim_end_matches('/'))
}

/// Runs the full ping/download/upload measurement against one candidate
/// server, failing (so the caller can move to the next candidate) if any
/// step doesn't succeed.
async fn measure_against_server(client: &Client, server: &ServerEntry) -> Result<SpeedtestResult> {
    let base = base_url(&server.url);
    let ping_url = format!("{base}/latency.txt");
    let download_url = format!("{base}/{DOWNLOAD_ASSET}");
    let upload_url = format!("{base}/upload.php");

    let (ping_ms, jitter_ms) = measure_ping_jitter_ms(client, &ping_url)
        .await
        .with_context(|| format!("ping failed against {} ({base})", server.name))?;
    // Ookla "Mini" servers speak plain HTTP (no ALPN/HTTP2 to multiplex over),
    // so each concurrent request already gets its own TCP connection —
    // sharing this client across streams is fine here.
    let shared = ClientStrategy::Shared(client);
    let download_mbps = measure_download_mbps(&shared, &download_url)
        .await
        .with_context(|| format!("download failed against {} ({base})", server.name))?;
    let upload_body = random_bytes(UPLOAD_BYTES);
    let upload_mbps = measure_upload_mbps(&shared, &upload_url, upload_body)
        .await
        .with_context(|| format!("upload failed against {} ({base})", server.name))?;

    Ok(SpeedtestResult {
        download_mbps,
        upload_mbps,
        ping_ms,
        jitter_ms,
        // Not measurable over HTTP.
        packet_loss_pct: 0.0,
        server: format!("{} - {}, {}", server.name, server.sponsor, server.country),
        isp: "unknown".to_string(),
        external_ip_v4: None,
        external_ip_v6: None,
        result_url: String::new(),
    })
}

/// Generates `len` random bytes to use as an upload body.
fn random_bytes(len: usize) -> bytes::Bytes {
    let mut buf = vec![0u8; len];
    rand::rng().fill_bytes(&mut buf);
    bytes::Bytes::from(buf)
}
