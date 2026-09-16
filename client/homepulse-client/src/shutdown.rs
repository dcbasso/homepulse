use tokio_util::sync::CancellationToken;
use tracing::info;

/// Spawns the OS-level signal listeners that trigger cooperative shutdown.
///
/// The Windows Service Control Manager's own stop request is handled
/// separately, in `windows_service::service_main`'s control handler — this
/// function only covers the console/interactive entry points: Unix signals
/// (`SIGTERM`, `SIGINT`) and, on Windows, Ctrl+C.
pub fn install_signal_handlers(token: CancellationToken) {
    #[cfg(unix)]
    {
        tokio::spawn(unix::wait_for_signals(token));
    }

    #[cfg(windows)]
    {
        tokio::spawn(windows::wait_for_ctrl_c(token));
    }
}

#[cfg(unix)]
mod unix {
    use super::CancellationToken;
    use tokio::signal::unix::{signal, SignalKind};
    use tracing::error;

    use super::info;

    /// Waits for `SIGTERM` or `SIGINT` and cancels `token` when either arrives.
    pub async fn wait_for_signals(token: CancellationToken) {
        let mut terminate = match signal(SignalKind::terminate()) {
            Ok(s) => s,
            Err(e) => {
                error!("Failed to install SIGTERM handler: {:?}", e);
                return;
            }
        };
        let mut interrupt = match signal(SignalKind::interrupt()) {
            Ok(s) => s,
            Err(e) => {
                error!("Failed to install SIGINT handler: {:?}", e);
                return;
            }
        };

        tokio::select! {
            _ = terminate.recv() => info!("Received SIGTERM, shutting down..."),
            _ = interrupt.recv() => info!("Received SIGINT, shutting down..."),
        }
        token.cancel();
    }
}

#[cfg(windows)]
mod windows {
    use super::info;
    use super::CancellationToken;
    use tracing::error;

    /// Waits for a console Ctrl+C event and cancels `token` when it arrives.
    ///
    /// Only relevant when running in console/interactive mode; when running
    /// as a registered Windows Service, shutdown is instead driven by the
    /// SCM's `SERVICE_CONTROL_STOP` request handled in `windows_service.rs`.
    pub async fn wait_for_ctrl_c(token: CancellationToken) {
        if let Err(e) = tokio::signal::ctrl_c().await {
            error!("Failed to listen for Ctrl+C: {:?}", e);
            return;
        }
        info!("Received Ctrl+C, shutting down...");
        token.cancel();
    }
}
