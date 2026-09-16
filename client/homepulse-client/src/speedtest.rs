use crate::config::SpeedtestConfig;
use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

/// How often the timeout loop polls the child process for completion.
const POLL_INTERVAL: Duration = Duration::from_millis(200);

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
/// Enforces the timeout by polling the child process with [`std::process::Child::try_wait`]
/// instead of relying on a platform-specific kill command, so it behaves the
/// same way on Linux and Windows.
///
/// # Errors
/// Returns an error if the binary cannot be started, the timeout is exceeded,
/// the process exits with a non-zero status, or the JSON output cannot be parsed.
pub fn run(config: &SpeedtestConfig) -> Result<SpeedtestResult> {
    let mut command = Command::new(&config.binary_path);
    command
        .args(["--format=json", "--accept-license", "--accept-gdpr"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let child = command.spawn().with_context(|| {
        format!(
            "Failed to start '{}'. Is it installed and on PATH?",
            config.binary_path
        )
    })?;

    let output = run_with_timeout(child, Duration::from_secs(config.timeout_seconds))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("speedtest exited with error: {}", stderr.trim());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw: RawResult = serde_json::from_str(&stdout)
        .with_context(|| format!("Failed to parse speedtest JSON: {}", stdout))?;

    if raw.result_type != "result" {
        return Err(anyhow!(
            "speedtest did not return a final result (type={})",
            raw.result_type
        ));
    }

    let bytes_to_mbps = |bandwidth: u64| (bandwidth as f64 * 8.0) / 1_000_000.0;

    Ok(SpeedtestResult {
        download_mbps: bytes_to_mbps(raw.download.bandwidth),
        upload_mbps: bytes_to_mbps(raw.upload.bandwidth),
        ping_ms: raw.ping.latency,
        jitter_ms: raw.ping.jitter,
        packet_loss_pct: raw.packet_loss.unwrap_or(0.0),
        server: format!(
            "{} - {}, {}",
            raw.server.name, raw.server.location, raw.server.country
        ),
        isp: raw.isp.unwrap_or_else(|| "unknown".to_string()),
        // Resolved by the caller via the `whoami` endpoints, not the Ookla CLI:
        // the CLI's `interface.externalIp` field is frequently absent in practice.
        external_ip_v4: None,
        external_ip_v6: None,
        result_url: raw.result.and_then(|r| r.url).unwrap_or_default(),
    })
}

/// Waits for `child` to exit, killing it if it does not finish within `timeout`.
///
/// Polls with [`Child::try_wait`] instead of blocking on a background thread,
/// and kills via [`Child::kill`] on timeout — both are cross-platform, so
/// this behaves identically on Linux and Windows.
///
/// # Errors
/// Returns an error if polling the process fails, if collecting its output
/// fails, or if `timeout` elapses before the process exits.
fn run_with_timeout(mut child: Child, timeout: Duration) -> Result<Output> {
    let started_at = Instant::now();

    loop {
        if child
            .try_wait()
            .context("Failed to poll speedtest process")?
            .is_some()
        {
            return child
                .wait_with_output()
                .context("Failed to collect speedtest output");
        }
        if started_at.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            bail!(
                "speedtest exceeded the timeout of {} seconds",
                timeout.as_secs()
            );
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a command that sleeps for `secs` seconds, using each
    /// platform's native sleep utility so the test needs no extra binary.
    fn sleep_command(secs: u64) -> Command {
        let mut command = if cfg!(windows) {
            let mut c = Command::new("ping");
            c.args(["127.0.0.1", "-n", &(secs + 1).to_string()]);
            c
        } else {
            let mut c = Command::new("sleep");
            c.arg(secs.to_string());
            c
        };
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        command
    }

    #[test]
    fn run_with_timeout_kills_process_that_exceeds_timeout() {
        let child = sleep_command(5)
            .spawn()
            .expect("failed to spawn sleep command");

        let result = run_with_timeout(child, Duration::from_millis(300));

        let err = result.expect_err("expected a timeout error");
        assert!(
            err.to_string().contains("exceeded the timeout"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn run_with_timeout_returns_output_when_process_finishes_in_time() {
        let child = sleep_command(0)
            .spawn()
            .expect("failed to spawn sleep command");

        let output = run_with_timeout(child, Duration::from_secs(10)).expect("expected success");

        assert!(output.status.success());
    }
}
