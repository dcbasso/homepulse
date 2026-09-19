//! Shared HTTP throughput/latency measurement primitives.
//!
//! Both the `cloudflare` and `librespeed` providers speak plain HTTP against
//! a fixed set of endpoints (a download URL, an upload URL, a ping URL) —
//! this module implements the actual measurement loop once so neither
//! provider has to duplicate it.

use anyhow::{bail, Result};
use futures_util::StreamExt;
use reqwest::Client;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// How long to run requests before counting bytes, to let TCP/TLS
/// connections and congestion control ramp up.
const WARMUP: Duration = Duration::from_secs(2);
/// How long to count bytes for, after warm-up.
const MEASURE_WINDOW: Duration = Duration::from_secs(8);
/// Number of concurrent streams used for download/upload measurement.
const CONCURRENCY: usize = 4;
/// Number of sequential round-trips sampled for ping/jitter.
const PING_SAMPLES: usize = 20;
/// HTTP/2 stream and connection flow-control window size, in bytes (16 MiB).
///
/// reqwest/hyper default to a 64 KiB window, which caps a single connection's
/// throughput to roughly `window / round_trip_time` regardless of the
/// underlying link's real bandwidth — a severe bottleneck against a
/// higher-RTT CDN edge. A 16 MiB window removes that cap on gigabit-class
/// links.
const HTTP2_WINDOW_SIZE: u32 = 16 * 1024 * 1024;

/// Builds a [`Client`] tuned for accurate throughput measurement.
///
/// # Errors
/// Returns an error if the underlying TLS backend fails to initialize.
pub fn build_client(timeout: Duration) -> Result<Client> {
    Client::builder()
        .timeout(timeout)
        .http2_initial_stream_window_size(HTTP2_WINDOW_SIZE)
        .http2_initial_connection_window_size(HTTP2_WINDOW_SIZE)
        .http2_adaptive_window(true)
        .build()
        .map_err(Into::into)
}

/// How [`measure_download_mbps`] and [`measure_upload_mbps`] obtain the
/// [`Client`] used by each of their [`CONCURRENCY`] concurrent streams.
pub enum ClientStrategy<'a> {
    /// Reuse one already-built client (cloned) for every stream. Correct
    /// when the target doesn't negotiate HTTP/2 (e.g. the plain-HTTP Ookla
    /// "Mini" server protocol), where each concurrent request naturally
    /// gets its own TCP connection regardless.
    Shared(&'a Client),
    /// Build a fresh client (and thus a distinct physical connection) per
    /// stream. Required over HTTPS/HTTP2, where reqwest otherwise
    /// multiplexes every concurrent request from a shared client onto one
    /// TCP connection — capping aggregate throughput at what that single
    /// flow's congestion window can grow to, well short of line rate on a
    /// higher-RTT path (e.g. a distant CDN edge).
    PerStream(Duration),
}

impl ClientStrategy<'_> {
    fn client_for_stream(&self) -> Result<Client> {
        match self {
            Self::Shared(client) => Ok((*client).clone()),
            Self::PerStream(timeout) => build_client(*timeout),
        }
    }
}

/// Measures download throughput in Mbps by issuing concurrent, repeated GET
/// requests to `url` for a fixed warm-up + measurement window, streaming
/// the response body so it is never fully buffered in memory.
///
/// See [`ClientStrategy`] for how each concurrent stream's client is
/// obtained.
///
/// # Errors
/// Returns an error if every request fails (e.g. the server is unreachable).
pub async fn measure_download_mbps(client_strategy: &ClientStrategy<'_>, url: &str) -> Result<f64> {
    let total_bytes = Arc::new(AtomicU64::new(0));
    let counting = Arc::new(AtomicBool::new(false));
    let stop = Arc::new(AtomicBool::new(false));
    let any_success = Arc::new(AtomicBool::new(false));

    let mut handles = Vec::with_capacity(CONCURRENCY);
    for _ in 0..CONCURRENCY {
        let client = client_strategy.client_for_stream()?;
        let url = url.to_string();
        let total_bytes = Arc::clone(&total_bytes);
        let counting = Arc::clone(&counting);
        let stop = Arc::clone(&stop);
        let any_success = Arc::clone(&any_success);
        handles.push(tokio::spawn(async move {
            while !stop.load(Ordering::Relaxed) {
                let Ok(response) = client.get(&url).send().await else {
                    continue;
                };
                any_success.store(true, Ordering::Relaxed);
                let mut stream = response.bytes_stream();
                while let Some(chunk) = stream.next().await {
                    if stop.load(Ordering::Relaxed) {
                        break;
                    }
                    if let Ok(bytes) = chunk {
                        if counting.load(Ordering::Relaxed) {
                            total_bytes.fetch_add(bytes.len() as u64, Ordering::Relaxed);
                        }
                    }
                }
            }
        }));
    }

    tokio::time::sleep(WARMUP).await;
    counting.store(true, Ordering::Relaxed);
    let measure_start = Instant::now();
    tokio::time::sleep(MEASURE_WINDOW).await;
    stop.store(true, Ordering::Relaxed);
    let elapsed = measure_start.elapsed().as_secs_f64();

    for handle in handles {
        let _ = handle.await;
    }

    if !any_success.load(Ordering::Relaxed) {
        bail!("all download requests to {url} failed");
    }

    let bytes = total_bytes.load(Ordering::Relaxed);
    Ok(bytes_to_mbps(bytes, elapsed))
}

/// Measures upload throughput in Mbps by issuing concurrent, repeated POST
/// requests to `url` with a fixed-size random body, for a fixed warm-up +
/// measurement window.
///
/// See [`ClientStrategy`] for how each concurrent stream's client is
/// obtained.
///
/// # Errors
/// Returns an error if every request fails.
pub async fn measure_upload_mbps(
    client_strategy: &ClientStrategy<'_>,
    url: &str,
    body: bytes::Bytes,
) -> Result<f64> {
    let total_bytes = Arc::new(AtomicU64::new(0));
    let counting = Arc::new(AtomicBool::new(false));
    let stop = Arc::new(AtomicBool::new(false));
    let any_success = Arc::new(AtomicBool::new(false));

    let mut handles = Vec::with_capacity(CONCURRENCY);
    for _ in 0..CONCURRENCY {
        let client = client_strategy.client_for_stream()?;
        let url = url.to_string();
        let body = body.clone();
        let total_bytes = Arc::clone(&total_bytes);
        let counting = Arc::clone(&counting);
        let stop = Arc::clone(&stop);
        let any_success = Arc::clone(&any_success);
        handles.push(tokio::spawn(async move {
            while !stop.load(Ordering::Relaxed) {
                let body_len = body.len() as u64;
                match client.post(&url).body(body.clone()).send().await {
                    Ok(response) if response.status().is_success() => {
                        any_success.store(true, Ordering::Relaxed);
                        if counting.load(Ordering::Relaxed) {
                            total_bytes.fetch_add(body_len, Ordering::Relaxed);
                        }
                    }
                    _ => continue,
                }
            }
        }));
    }

    tokio::time::sleep(WARMUP).await;
    counting.store(true, Ordering::Relaxed);
    let measure_start = Instant::now();
    tokio::time::sleep(MEASURE_WINDOW).await;
    stop.store(true, Ordering::Relaxed);
    let elapsed = measure_start.elapsed().as_secs_f64();

    for handle in handles {
        let _ = handle.await;
    }

    if !any_success.load(Ordering::Relaxed) {
        bail!("all upload requests to {url} failed");
    }

    let bytes = total_bytes.load(Ordering::Relaxed);
    Ok(bytes_to_mbps(bytes, elapsed))
}

/// Measures ping (mean round-trip time) and jitter (mean absolute
/// difference between consecutive round-trips) in milliseconds, by issuing
/// sequential GET requests to `url` over a reused (pooled) connection.
///
/// # Errors
/// Returns an error if every round-trip fails.
pub async fn measure_ping_jitter_ms(client: &Client, url: &str) -> Result<(f64, f64)> {
    // Warm the connection (DNS + TCP + TLS handshake) once, uncounted.
    let _ = client.get(url).send().await;

    let mut samples = Vec::with_capacity(PING_SAMPLES);
    for _ in 0..PING_SAMPLES {
        let start = Instant::now();
        if client.get(url).send().await.is_ok() {
            samples.push(start.elapsed().as_secs_f64() * 1000.0);
        }
    }

    if samples.is_empty() {
        bail!("all ping round-trips to {url} failed");
    }

    let ping_ms = samples.iter().sum::<f64>() / samples.len() as f64;
    let jitter_ms = if samples.len() > 1 {
        let diffs: Vec<f64> = samples.windows(2).map(|w| (w[1] - w[0]).abs()).collect();
        diffs.iter().sum::<f64>() / diffs.len() as f64
    } else {
        0.0
    };

    Ok((ping_ms, jitter_ms))
}

/// Converts a byte count measured over `elapsed_secs` into megabits per second.
fn bytes_to_mbps(bytes: u64, elapsed_secs: f64) -> f64 {
    if elapsed_secs <= 0.0 {
        return 0.0;
    }
    (bytes as f64 * 8.0) / 1_000_000.0 / elapsed_secs
}
