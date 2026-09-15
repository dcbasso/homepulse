//! Speedtest measurement engine.
//!
//! Measures download, upload, ping, and jitter entirely in-process (no
//! external binary, no OS-specific process spawning), through a small
//! [`Provider`] abstraction so the backend can be swapped or extended
//! without touching the rest of the client.
//!
//! Available providers, selected via `config.provider` (each gated by a
//! Cargo feature of the same name, except `"speedtest"` which is an alias
//! for `"ookla"`):
//! - `"cloudflare"` — public `speed.cloudflare.com` endpoints, no setup required.
//! - `"librespeed"` — a self-hosted LibreSpeed backend, URL provided via config.
//! - `"ookla"` / `"speedtest"` — speaks the speedtest.net (Ookla) "Mini"
//!   server protocol directly over HTTP (see [`ookla`]), the same network
//!   the official `speedtest` CLI this client used to shell out to. Tries
//!   several nearest candidate servers with fallback, since individual
//!   Ookla "Mini" servers are frequently unreliable.

#[cfg(feature = "cloudflare")]
mod cloudflare;
#[cfg(feature = "librespeed")]
mod librespeed;
#[cfg(feature = "ookla")]
mod ookla;
#[cfg(any(feature = "cloudflare", feature = "librespeed", feature = "ookla"))]
mod http_throughput;

use crate::config::SpeedtestConfig;
use anyhow::{bail, Result};

/// Speedtest measurement converted to human-readable units (Mbps),
/// ready to be sent to the Ingest API.
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

/// A backend capable of running a full speedtest (download, upload, ping,
/// jitter) and returning a [`SpeedtestResult`].
#[async_trait::async_trait]
trait Provider {
    async fn run(&self, config: &SpeedtestConfig) -> Result<SpeedtestResult>;
}

/// Runs a speedtest using the provider selected by `config.provider`.
///
/// # Errors
/// Returns an error if the configured provider name is unknown, if this
/// binary was compiled without the matching Cargo feature, or if the
/// measurement itself fails (network error, timeout, malformed response).
pub async fn run(config: &SpeedtestConfig) -> Result<SpeedtestResult> {
    match config.provider.as_str() {
        #[cfg(feature = "cloudflare")]
        "cloudflare" => cloudflare::CloudflareProvider.run(config).await,
        #[cfg(feature = "librespeed")]
        "librespeed" => librespeed::LibreSpeedProvider.run(config).await,
        #[cfg(feature = "ookla")]
        "ookla" | "speedtest" => ookla::OoklaProvider.run(config).await,
        other => bail!(
            "Unknown or not-compiled-in speedtest provider '{other}'. \
             This binary was built with features: {}",
            compiled_providers().join(", ")
        ),
    }
}

/// Names of the providers compiled into this binary, used only for error
/// messages when `config.provider` names a provider this build lacks.
#[allow(clippy::vec_init_then_push, unused_mut)]
fn compiled_providers() -> Vec<&'static str> {
    let mut providers = Vec::new();
    #[cfg(feature = "cloudflare")]
    providers.push("cloudflare");
    #[cfg(feature = "librespeed")]
    providers.push("librespeed");
    #[cfg(feature = "ookla")]
    providers.push("ookla (or \"speedtest\")");
    providers
}
