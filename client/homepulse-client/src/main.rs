mod config;
mod ingest;
mod shutdown;
mod speedtest;
mod whoami;
#[cfg(windows)]
mod windows_service;

use anyhow::Result;
use clap::Parser;
use config::Config;
use std::path::PathBuf;
use std::time::Duration;
use tokio::time::interval;
use tokio_util::sync::CancellationToken;
use tracing::{error, info};

/// Number of seconds in a minute, used to convert configured intervals to [`Duration`]s.
const SECONDS_PER_MINUTE: u64 = 60;

/// Command-line arguments for the homepulse client.
#[derive(Parser, Debug)]
#[command(name = "homepulse-client")]
#[command(
    about = "Runs a liveness heartbeat loop and a speedtest loop, posting both to the Ingest API"
)]
struct Args {
    /// Path to the config.json file. Defaults to a platform-specific
    /// location (see [`config::default_config_path`]) when not given.
    #[arg(short, long)]
    config: Option<PathBuf>,

    /// Run in the foreground instead of registering with the Windows
    /// Service Control Manager. Has no effect on non-Windows platforms,
    /// where foreground is already the only mode.
    #[cfg(windows)]
    #[arg(long)]
    console: bool,

    #[cfg(windows)]
    #[command(subcommand)]
    command: Option<WindowsCommand>,
}

/// Windows-only subcommands for self-managing the Windows Service
/// registration, so `packaging/windows/install.ps1` only needs to invoke
/// the binary itself instead of calling `sc.exe` directly.
#[cfg(windows)]
#[derive(clap::Subcommand, Debug)]
enum WindowsCommand {
    /// Registers homepulse-client as an auto-starting Windows Service.
    Install,
    /// Removes the homepulse-client Windows Service registration.
    Uninstall,
    /// Starts the installed Windows Service.
    Start,
    /// Stops the running Windows Service.
    Stop,
}

fn main() -> Result<()> {
    let args = Args::parse();

    #[cfg(windows)]
    {
        if let Some(command) = &args.command {
            return dispatch_windows_command(command, &args);
        }

        // `run_dispatcher` blocks for the lifetime of the service and only
        // returns `Ok` once the SCM has fully stopped it. It fails fast
        // when the process was not actually launched by the SCM (e.g. run
        // manually from a terminal), in which case we fall back to the
        // console path below.
        if !args.console && windows_service::run_dispatcher().is_ok() {
            return Ok(());
        }
    }

    run_console(args)
}

/// Dispatches an install/uninstall/start/stop subcommand and exits.
///
/// These operate purely through the Service Control Manager and don't need
/// a Tokio runtime.
///
/// # Errors
/// Returns an error if the underlying Windows Service operation fails.
#[cfg(windows)]
fn dispatch_windows_command(command: &WindowsCommand, args: &Args) -> Result<()> {
    match command {
        WindowsCommand::Install => {
            let config_path = args
                .config
                .clone()
                .unwrap_or_else(config::default_config_path);
            windows_service::install(&config_path)
        }
        WindowsCommand::Uninstall => windows_service::uninstall(),
        WindowsCommand::Start => windows_service::start(),
        WindowsCommand::Stop => windows_service::stop(),
    }
}

/// Runs the client in the foreground: the only mode on Linux, and the
/// interactive/`--console` mode on Windows.
///
/// Sets up stdout logging, loads the config, wires up OS signal handlers for
/// cooperative shutdown, and runs [`run_app`] to completion.
///
/// # Errors
/// Returns an error if the config file cannot be loaded.
fn run_console(args: Args) -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config_path = args.config.unwrap_or_else(config::default_config_path);
    let cfg = Config::load(&config_path)?;

    let token = CancellationToken::new();
    shutdown::install_signal_handlers(token.clone());

    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(run_app(cfg, token));
    Ok(())
}

/// Runs the heartbeat and speedtest loops until `token` is cancelled.
///
/// Shared between the console entry point and, on Windows,
/// `windows_service::service_main`, so both drive the exact same
/// application logic.
pub async fn run_app(cfg: Config, token: CancellationToken) {
    let heartbeat_task = run_heartbeat_loop(cfg.clone(), token.clone());
    let speedtest_task = run_speedtest_loop(cfg, token);

    tokio::join!(heartbeat_task, speedtest_task);
}

/// Runs the liveness heartbeat loop until `token` is cancelled, ticking
/// every `cfg.heartbeat.interval_minutes` minutes.
///
/// Each tick resolves the public IP via the `whoami` endpoint and posts a
/// heartbeat to the Ingest API, authenticated with the household's API key.
/// Any failure is logged and the loop continues to the next tick rather than
/// aborting the process.
///
/// # Arguments
/// * `cfg` - Full application configuration.
/// * `token` - Cancelled to request a graceful shutdown.
async fn run_heartbeat_loop(cfg: Config, token: CancellationToken) {
    let period = Duration::from_secs(cfg.heartbeat.interval_minutes * SECONDS_PER_MINUTE);
    let mut ticker = interval(period);

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                if let Err(e) = run_heartbeat_once(&cfg).await {
                    error!("Heartbeat tick failed: {:?}", e);
                }
            }
            _ = token.cancelled() => {
                info!("Heartbeat loop shutting down.");
                break;
            }
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

/// Runs the speedtest loop until `token` is cancelled, ticking every
/// `cfg.speedtest.interval_minutes` minutes.
///
/// Each tick runs the Ookla `speedtest` CLI and posts the result to the
/// Ingest API, authenticated with the household's API key. Any failure is
/// logged and the loop continues to the next tick rather than aborting the
/// process.
///
/// # Arguments
/// * `cfg` - Full application configuration.
/// * `token` - Cancelled to request a graceful shutdown.
async fn run_speedtest_loop(cfg: Config, token: CancellationToken) {
    let period = Duration::from_secs(cfg.speedtest.interval_minutes * SECONDS_PER_MINUTE);
    let mut ticker = interval(period);

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                if let Err(e) = run_speedtest_once(&cfg).await {
                    error!("Speedtest tick failed: {:?}", e);
                }
            }
            _ = token.cancelled() => {
                info!("Speedtest loop shutting down.");
                break;
            }
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
