use anyhow::{Context, Result};
use serde::Deserialize;
use std::fs;
use std::path::Path;

/// Root configuration loaded from `config.json`.
///
/// Only the fields consumed by this binary are declared here; other fields
/// present in the JSON file (e.g. `log`) are ignored by serde.
#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    pub heartbeat: HeartbeatConfig,
    pub speedtest: SpeedtestConfig,
    pub ingest: IngestConfig,
}

/// Settings for the liveness heartbeat loop.
///
/// The heartbeat is a cheap, frequent HTTP call that proves connectivity
/// without running the much more expensive speedtest measurement.
#[derive(Debug, Deserialize, Clone)]
pub struct HeartbeatConfig {
    pub interval_minutes: u64,
    /// `whoami` endpoint. Its domain is dual-stack (both `A` and `AAAA`
    /// DNS records), so the same URL is queried twice by the client: once
    /// forcing an IPv4 socket, once forcing an IPv6 socket.
    pub whoami_url: String,
}

/// Settings for the speedtest measurement engine and its run cadence.
#[derive(Debug, Deserialize, Clone)]
pub struct SpeedtestConfig {
    /// Which measurement backend to use: `"cloudflare"`, `"librespeed"`, or
    /// `"ookla"` (alias: `"speedtest"` — the same speedtest.net/Ookla server
    /// network the official `speedtest` CLI used, measured natively over
    /// HTTP with fallback across candidate servers). See the `speedtest`
    /// module docs for details on each.
    pub provider: String,
    /// Base URL of a self-hosted LibreSpeed backend. Required (and only
    /// used) when `provider = "librespeed"`.
    #[serde(default)]
    pub librespeed_url: Option<String>,
    pub timeout_seconds: u64,
    pub interval_minutes: u64,
    /// See [`HeartbeatConfig::whoami_url`].
    pub whoami_url: String,
}

/// Ingest API connection settings (ADR 0004, ADR 0010).
///
/// Replaces the previous direct-Firestore Service Account credential: the
/// client now authenticates with a long-lived per-household API key instead
/// of holding any GCP identity.
///
/// `heartbeat_url` and `speedtest_url` are two separate URLs (rather than a
/// single base `ingest_url` + path) because each is deployed as its own
/// Cloud Functions Gen2 service (see `terraform/function.tf`) with its own
/// host, matching the `ingest_heartbeat_url` / `ingest_speedtest_url`
/// Terraform outputs.
#[derive(Debug, Deserialize, Clone)]
pub struct IngestConfig {
    /// Raw API key in the form `hpk_<household_id>_<random>`, issued by
    /// `scripts/issue_api_key.py`. Sent as `Authorization: ApiKey <api_key>`.
    pub api_key: String,
    /// Household ID this client belongs to. Not sent to the server (the
    /// server resolves it from the API key hash), kept here for logging.
    pub household_id: String,
    /// URL of the `ingest-heartbeat` Cloud Function.
    pub heartbeat_url: String,
    /// URL of the `ingest-speedtest` Cloud Function.
    pub speedtest_url: String,
}

impl Config {
    /// Loads and deserializes the configuration from the given JSON file path.
    ///
    /// # Errors
    /// Returns an error if the file cannot be read or if the JSON is malformed.
    pub fn load(path: &Path) -> Result<Self> {
        let raw = fs::read_to_string(path)
            .with_context(|| format!("Failed to read config at {:?}", path))?;
        let config: Config = serde_json::from_str(&raw)
            .context("Failed to parse config.json")?;
        Ok(config)
    }
}
