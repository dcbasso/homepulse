use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// Subset of the JSON body returned by the `whoami` GCP endpoint.
#[derive(Debug, Deserialize)]
struct WhoamiResponse {
    ip: String,
}

/// Fetches the caller's public IPv4 address from the `whoami` endpoint.
///
/// The endpoint's domain is dual-stack, so the IP family returned depends on
/// which socket family the outgoing connection uses, not on the URL. This
/// forces an IPv4 socket via [`reqwest::ClientBuilder::local_address`] (the
/// same mechanism `curl -4` uses).
///
/// # Arguments
/// * `url` - Full URL of the `whoami` endpoint.
///
/// # Errors
/// Returns an error if the HTTP request fails or the response body cannot be
/// parsed as `{"ip": "..."}`.
pub async fn fetch_external_ipv4(url: &str) -> Result<String> {
    fetch_with_local_address(url, IpAddr::V4(Ipv4Addr::UNSPECIFIED)).await
}

/// Fetches the caller's public IPv6 address from the `whoami` endpoint.
///
/// See [`fetch_external_ipv4`] for why the IP family is chosen by the
/// outgoing socket rather than the URL.
///
/// # Arguments
/// * `url` - Full URL of the `whoami` endpoint.
///
/// # Errors
/// Returns an error if the HTTP request fails (e.g. no IPv6 connectivity) or
/// the response body cannot be parsed as `{"ip": "..."}`.
pub async fn fetch_external_ipv6(url: &str) -> Result<String> {
    fetch_with_local_address(url, IpAddr::V6(Ipv6Addr::UNSPECIFIED)).await
}

/// Calls the `whoami` endpoint over a socket bound to the given IP family.
///
/// The endpoint is public and requires no authentication: the write to
/// Firestore (via a valid Service Account token) is what proves identity,
/// not this lookup.
async fn fetch_with_local_address(url: &str, local_address: IpAddr) -> Result<String> {
    let client = reqwest::Client::builder()
        .local_address(local_address)
        .build()
        .context("Failed to build the whoami HTTP client")?;

    let response = client
        .get(url)
        .send()
        .await
        .context("Failed to call the whoami endpoint")?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        bail!("whoami endpoint returned an error ({}): {}", status, body);
    }

    let parsed: WhoamiResponse = serde_json::from_str(&body)
        .with_context(|| format!("Unexpected response from whoami endpoint: {}", body))?;

    Ok(parsed.ip)
}
