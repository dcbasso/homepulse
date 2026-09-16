//! Native Windows Service integration for `homepulse-client`.
//!
//! Wraps the [`windows_service`] crate so the binary can register itself
//! with the Service Control Manager (SCM), and so the same [`crate::run_app`]
//! loop used in console mode also runs correctly under the SCM: reporting
//! state transitions and reacting to `SERVICE_CONTROL_STOP` by cancelling a
//! [`CancellationToken`], the same cooperative shutdown mechanism used for
//! Unix signals in `shutdown.rs`.

use crate::config::Config;
use anyhow::{Context, Result};
use std::ffi::OsString;
use std::path::Path;
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use tracing::{error, info};
use windows_service::service::{
    ServiceAccess, ServiceControl, ServiceControlAccept, ServiceErrorControl, ServiceExitCode,
    ServiceInfo, ServiceStartType, ServiceState, ServiceStatus, ServiceType,
};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::service_dispatcher;
use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

/// Name the service is registered under, and the source name used for
/// Windows Event Log entries (see `eventlog::register` in `main.rs`).
pub const SERVICE_NAME: &str = "HomePulseClient";

/// Display name shown in `services.msc`.
const SERVICE_DISPLAY_NAME: &str = "HomePulse Client";

windows_service::define_windows_service!(ffi_service_main, service_main);

/// Registers this process with the SCM and blocks until the service stops.
///
/// Must only be called when the process was actually launched by the SCM;
/// otherwise it returns an error, which the caller in `main.rs` uses to fall
/// back to console mode.
///
/// # Errors
/// Returns an error if the SCM dispatcher cannot be started (e.g. the
/// process was not launched by the SCM).
pub fn run_dispatcher() -> Result<()> {
    service_dispatcher::start(SERVICE_NAME, ffi_service_main)
        .context("Failed to start the Windows Service dispatcher")
}

/// Entry point invoked by the SCM via [`ffi_service_main`].
///
/// Sets up Event Log logging, registers the control handler, reports state
/// transitions to the SCM, and runs [`crate::run_app`] to completion on a
/// dedicated Tokio runtime, cancelling it when a `Stop` control is received.
fn service_main(_arguments: Vec<OsString>) {
    if let Err(e) = init_event_log_logging() {
        // No logging sink is available yet if this fails, so there is
        // nowhere useful to report the error besides giving up silently.
        let _ = e;
    }

    if let Err(e) = run_service() {
        error!("Windows service exited with error: {:?}", e);
    }
}

/// Does the real work of `service_main`, returning a [`Result`] so errors
/// can be logged uniformly instead of only via `panic`.
fn run_service() -> Result<()> {
    let token = CancellationToken::new();
    let stop_token = token.clone();

    let status_handle =
        service_control_handler::register(SERVICE_NAME, move |control| match control {
            ServiceControl::Stop => {
                info!("Received SERVICE_CONTROL_STOP, shutting down...");
                stop_token.cancel();
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        })
        .context("Failed to register the service control handler")?;

    report_status(&status_handle, ServiceState::StartPending)?;

    let config_path = crate::config::default_config_path();
    let cfg = Config::load(&config_path)
        .with_context(|| format!("Failed to load config at {:?}", config_path))?;

    report_status(&status_handle, ServiceState::Running)?;

    let runtime = tokio::runtime::Runtime::new().context("Failed to create the Tokio runtime")?;
    runtime.block_on(crate::run_app(cfg, token));

    report_status(&status_handle, ServiceState::Stopped)?;
    Ok(())
}

/// Reports a service state transition to the SCM, filling in the fields
/// that stay constant across every transition this service goes through.
///
/// # Errors
/// Returns an error if the SCM rejects the status update.
fn report_status(
    status_handle: &windows_service::service_control_handler::ServiceStatusHandle,
    state: ServiceState,
) -> Result<()> {
    let controls_accepted = match state {
        ServiceState::Running | ServiceState::StopPending => ServiceControlAccept::STOP,
        _ => ServiceControlAccept::empty(),
    };

    status_handle
        .set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: state,
            controls_accepted,
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: Duration::default(),
            process_id: None,
        })
        .context("Failed to report service status to the SCM")
}

/// Registers `HomePulseClient` as a Windows Event Log source and points the
/// `log` facade (bridged from `tracing` via its `log-always` feature) at it,
/// so every `tracing::info!`/`error!` call ends up in the Application log.
///
/// # Errors
/// Returns an error if the event source cannot be registered or the log
/// backend cannot be initialized (e.g. missing registry permissions).
fn init_event_log_logging() -> Result<()> {
    eventlog::init(SERVICE_NAME, log::Level::Info).context("Failed to initialize Event Log logging")
}

/// Registers `HomePulseClient` as a Windows Event Log source.
///
/// Run once, from the `install` subcommand, which already requires
/// Administrator privileges — registering the source needs write access to
/// `HKLM`.
///
/// # Errors
/// Returns an error if the registry key cannot be created.
fn register_event_source() -> Result<()> {
    eventlog::register(SERVICE_NAME).context("Failed to register the Windows Event Log source")
}

/// Installs `homepulse-client` as an auto-starting Windows Service, pointing
/// it at the given config file.
///
/// # Errors
/// Returns an error if the current executable path cannot be resolved, if
/// the SCM connection fails, or if a service with the same name already
/// exists.
pub fn install(config_path: &Path) -> Result<()> {
    register_event_source()?;

    let executable_path =
        std::env::current_exe().context("Failed to resolve the current executable path")?;

    let manager =
        ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CREATE_SERVICE)
            .context("Failed to connect to the Service Control Manager")?;

    let service_info = ServiceInfo {
        name: OsString::from(SERVICE_NAME),
        display_name: OsString::from(SERVICE_DISPLAY_NAME),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path,
        launch_arguments: vec![
            OsString::from("--config"),
            config_path.as_os_str().to_os_string(),
        ],
        dependencies: vec![],
        account_name: None,
        account_password: None,
    };

    manager
        .create_service(&service_info, ServiceAccess::empty())
        .context("Failed to create the Windows Service")?;

    info!("Service '{}' installed.", SERVICE_NAME);
    Ok(())
}

/// Removes the `homepulse-client` Windows Service registration.
///
/// The service should be stopped first (see [`stop`]); Windows marks a
/// running service for deletion but only actually removes it once stopped.
///
/// # Errors
/// Returns an error if the SCM connection fails or the service cannot be
/// opened.
pub fn uninstall() -> Result<()> {
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .context("Failed to connect to the Service Control Manager")?;
    let service = manager
        .open_service(SERVICE_NAME, ServiceAccess::DELETE)
        .context("Failed to open the service for deletion")?;

    service.delete().context("Failed to delete the service")?;
    info!("Service '{}' uninstalled.", SERVICE_NAME);
    Ok(())
}

/// Starts the already-installed `homepulse-client` Windows Service.
///
/// # Errors
/// Returns an error if the SCM connection fails, the service cannot be
/// opened, or the start request is rejected.
pub fn start() -> Result<()> {
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .context("Failed to connect to the Service Control Manager")?;
    let service = manager
        .open_service(SERVICE_NAME, ServiceAccess::START)
        .context("Failed to open the service to start it")?;

    service
        .start::<&str>(&[])
        .context("Failed to start the service")?;
    info!("Service '{}' started.", SERVICE_NAME);
    Ok(())
}

/// Stops the running `homepulse-client` Windows Service.
///
/// # Errors
/// Returns an error if the SCM connection fails, the service cannot be
/// opened, or the stop request is rejected.
pub fn stop() -> Result<()> {
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .context("Failed to connect to the Service Control Manager")?;
    let service = manager
        .open_service(SERVICE_NAME, ServiceAccess::STOP)
        .context("Failed to open the service to stop it")?;

    service.stop().context("Failed to stop the service")?;
    info!("Service '{}' stopped.", SERVICE_NAME);
    Ok(())
}
