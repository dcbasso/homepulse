use crate::config::SpeedtestConfig;
use anyhow::{anyhow, bail, Context, Result};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// Subset of the JSON returned by `speedtest --format=json` (Ookla official CLI).
/// Fields not used are ignored by serde.
#[derive(Debug, Deserialize)]
struct RawResult {
    #[serde(rename = "type")]
    result_type: String,
    ping: RawPing,
    download: RawTransfer,
    upload: RawTransfer,
    #[serde(rename = "packetLoss")]
    packet_loss: Option<f64>,
    isp: Option<String>,
    server: RawServer,
    result: Option<RawResultLink>,
}

#[derive(Debug, Deserialize)]
struct RawPing {
    jitter: f64,
    latency: f64,
}

#[derive(Debug, Deserialize)]
struct RawTransfer {
    /// bytes per second
    bandwidth: u64,
}

#[derive(Debug, Deserialize)]
struct RawServer {
    name: String,
    location: String,
    country: String,
}

#[derive(Debug, Deserialize)]
struct RawResultLink {
    url: Option<String>,
}

/// Speedtest measurement converted to human-readable units (Mbps),
/// ready to be persisted to Firestore.
#[derive(Debug)]
pub struct SpeedtestResult {
    pub timestamp: DateTime<Utc>,
    pub download_mbps: f64,
    pub upload_mbps: f64,
    pub ping_ms: f64,
    pub jitter_ms: f64,
    pub packet_loss_pct: f64,
    pub server: String,
    pub isp: String,
    /// Public IPv4 address, resolved separately via the `whoami` endpoint.
    pub external_ip_v4: Option<String>,
    /// Public IPv6 address, resolved separately via the `whoami` endpoint.
    pub external_ip_v6: Option<String>,
    pub result_url: String,
}

/// Runs the `speedtest` CLI binary and returns the parsed measurement.
///
/// Uses a background thread + channel to enforce the timeout without relying
/// on additional async or OS-specific mechanisms.
///
/// # Errors
/// Returns an error if the binary cannot be started, the timeout is exceeded,
/// the process exits with a non-zero status, or the JSON output cannot be parsed.
pub fn run(config: &SpeedtestConfig) -> Result<SpeedtestResult> {
    let child = Command::new(&config.binary_path)
        .args(["--format=json", "--accept-license", "--accept-gdpr"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| format!("Failed to start '{}'. Is it installed and on PATH?", config.binary_path))?;

    let (tx, rx) = mpsc::channel();
    let pid = child.id();
    let timeout = Duration::from_secs(config.timeout_seconds);

    // Separate thread to wait for the child process without blocking the main thread.
    let wait_handle = thread::spawn(move || {
        let result = child.wait_with_output();
        let _ = tx.send(result);
    });

    let output = match rx.recv_timeout(timeout) {
        Ok(result) => result.context("Failed to collect speedtest output")?,
        Err(_) => {
            let _ = Command::new("kill").arg("-9").arg(pid.to_string()).status();
            bail!("speedtest exceeded the timeout of {} seconds", config.timeout_seconds);
        }
    };
    let _ = wait_handle.join();

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("speedtest exited with error: {}", stderr.trim());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw: RawResult = serde_json::from_str(&stdout)
        .with_context(|| format!("Failed to parse speedtest JSON: {}", stdout))?;

    if raw.result_type != "result" {
        return Err(anyhow!("speedtest did not return a final result (type={})", raw.result_type));
    }

    let bytes_to_mbps = |bandwidth: u64| (bandwidth as f64 * 8.0) / 1_000_000.0;

    Ok(SpeedtestResult {
        timestamp: Utc::now(),
        download_mbps: bytes_to_mbps(raw.download.bandwidth),
        upload_mbps: bytes_to_mbps(raw.upload.bandwidth),
        ping_ms: raw.ping.latency,
        jitter_ms: raw.ping.jitter,
        packet_loss_pct: raw.packet_loss.unwrap_or(0.0),
        server: format!("{} - {}, {}", raw.server.name, raw.server.location, raw.server.country),
        isp: raw.isp.unwrap_or_else(|| "unknown".to_string()),
        // Resolved by the caller via the `whoami` endpoints, not the Ookla CLI:
        // the CLI's `interface.externalIp` field is frequently absent in practice.
        external_ip_v4: None,
        external_ip_v6: None,
        result_url: raw.result.and_then(|r| r.url).unwrap_or_default(),
    })
}
