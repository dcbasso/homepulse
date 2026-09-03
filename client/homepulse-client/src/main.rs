mod config;
mod ingest;
mod speedtest;
mod whoami;

use anyhow::Result;
use clap::Parser;
use config::Config;
use std::path::PathBuf;
use std::time::Duration;
use tokio::time::interval;
use tracing::{error, info};

/// Number of seconds in a minute, used to convert configured intervals to [`Duration`]s.
const SECONDS_PER_MINUTE: u64 = 60;

/// Command-line arguments for the homepulse client.
#[derive(Parser, Debug)]
#[command(name = "homepulse-client")]
#[command(about = "Runs a liveness heartbeat loop and a speedtest loop, posting both to the Ingest API")]
struct Args {
    /// Path to the config.json file.
    #[arg(short, long, default_value = "config.json")]
    config: PathBuf,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let args = Args::parse();
    let cfg = Config::load(&args.config)?;

    let heartbeat_task = run_heartbeat_loop(cfg.clone());
    let speedtest_task = run_speedtest_loop(cfg);

    tokio::join!(heartbeat_task, speedtest_task);
    Ok(())
}

/// Runs the liveness heartbeat loop forever, ticking every
/// `cfg.heartbeat.interval_minutes` minutes.
///
/// Each tick resolves the public IP via the `whoami` endpoint and posts a
/// heartbeat to the Ingest API, authenticated with the household's API key.
/// Any failure is logged and the loop continues to the next tick rather than
/// aborting the process.
///
/// # Arguments
/// * `cfg` - Full application configuration.
async fn run_heartbeat_loop(cfg: Config) {
    let period = Duration::from_secs(cfg.heartbeat.interval_minutes * SECONDS_PER_MINUTE);
    let mut ticker = interval(period);

    loop {
        ticker.tick().await;
        if let Err(e) = run_heartbeat_once(&cfg).await {
            error!("Heartbeat tick failed: {:?}", e);
        }
    }
}

/// Performs a single heartbeat tick: resolve public IP, post to the Ingest API.
///
/// # Errors
/// Returns an error if the Ingest API call fails. A failed IP lookup does
/// not cause an error; `None` is passed through instead.
async fn run_heartbeat_once(cfg: &Config) -> Result<()> {
    let (external_ip_v4, external_ip_v6) = resolve_external_ips(&cfg.heartbeat.whoami_url).await;

    ingest::append_heartbeat(
        &cfg.ingest,
        external_ip_v4.as_deref(),
        external_ip_v6.as_deref(),
    )
    .await?;

    info!(
        "Heartbeat sent (household_id={}, external_ip_v4={:?}, external_ip_v6={:?})",
        cfg.ingest.household_id, external_ip_v4, external_ip_v6
    );
    Ok(())
}

/// Resolves the caller's public IPv4 and IPv6 addresses by calling the same
/// `whoami` endpoint twice, forcing a different socket family each time
/// (the endpoint's domain is dual-stack), logging a warning per family that
/// fails instead of silently falling back to a placeholder.
///
/// # Arguments
/// * `whoami_url` - Dual-stack `whoami` endpoint URL.
async fn resolve_external_ips(whoami_url: &str) -> (Option<String>, Option<String>) {
    let v4 = match whoami::fetch_external_ipv4(whoami_url).await {
        Ok(ip) => Some(ip),
        Err(e) => {
            error!("Failed to resolve external IPv4: {:?}", e);
            None
        }
    };
    let v6 = match whoami::fetch_external_ipv6(whoami_url).await {
        Ok(ip) => Some(ip),
        Err(e) => {
            error!("Failed to resolve external IPv6: {:?}", e);
            None
        }
    };
    (v4, v6)
}

/// Runs the speedtest loop forever, ticking every `cfg.speedtest.interval_minutes` minutes.
///
/// Each tick runs the Ookla `speedtest` CLI and posts the result to the
/// Ingest API, authenticated with the household's API key. Any failure is
/// logged and the loop continues to the next tick rather than aborting the
/// process.
///
/// # Arguments
/// * `cfg` - Full application configuration.
async fn run_speedtest_loop(cfg: Config) {
    let period = Duration::from_secs(cfg.speedtest.interval_minutes * SECONDS_PER_MINUTE);
    let mut ticker = interval(period);

    loop {
        ticker.tick().await;
        if let Err(e) = run_speedtest_once(&cfg).await {
            error!("Speedtest tick failed: {:?}", e);
        }
    }
}

/// Performs a single speedtest tick: run Ookla, post the result to the Ingest API.
///
/// # Errors
/// Returns an error if the speedtest binary fails or the Ingest API call fails.
async fn run_speedtest_once(cfg: &Config) -> Result<()> {
    info!("Running speedtest...");
    let mut result = speedtest::run(&cfg.speedtest)?;

    let (external_ip_v4, external_ip_v6) = resolve_external_ips(&cfg.speedtest.whoami_url).await;
    result.external_ip_v4 = external_ip_v4;
    result.external_ip_v6 = external_ip_v6;

    info!(
        "Result: download={:.2} Mbps upload={:.2} Mbps ping={:.1} ms external_ip_v4={:?} external_ip_v6={:?}",
        result.download_mbps, result.upload_mbps, result.ping_ms, result.external_ip_v4, result.external_ip_v6
    );

    ingest::append_document(&cfg.ingest, &result).await?;

    info!("Speedtest result sent.");
    Ok(())
}
