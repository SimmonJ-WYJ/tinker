//! 系统解析只在同binary短命子进程执行；主进程绝不调用系统DNS后备。
use crate::desktop_runtime::protocol::{DesktopError, Result};
use std::net::SocketAddr;
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    host: String,
    port: u16,
}
fn validate(host: &str, port: u16) -> Result<()> {
    if host.is_empty()
        || host.len() > 253
        || port == 0
        || host
            .bytes()
            .any(|b| !b.is_ascii_alphanumeric() && b != b'.' && b != b'-')
        || host
            .split('.')
            .any(|s| s.is_empty() || s.len() > 63 || s.starts_with('-') || s.ends_with('-'))
    {
        return Err(DesktopError("invalidEndpoint"));
    }
    Ok(())
}
pub(crate) fn resolve(
    host: &str,
    port: u16,
    cancelled: &impl Fn() -> bool,
) -> Result<Vec<SocketAddr>> {
    if cancelled() {
        return Err(DesktopError("staleGeneration"));
    }
    validate(host, port)?;
    let input = serde_json::to_vec(&Request {
        host: host.into(),
        port,
    })
    .map_err(|_| DesktopError("invalidEndpoint"))?;
    let bytes = super::process::run("resolve", &input, 4096, cancelled)?;
    let addresses: Vec<SocketAddr> =
        serde_json::from_slice(&bytes).map_err(|_| DesktopError("resolverUnavailable"))?;
    if addresses.is_empty()
        || addresses.len() > 16
        || addresses
            .iter()
            .any(|a| a.port() != port || !super::catalog::public_address(a.ip()))
    {
        return Err(DesktopError("invalidEndpoint"));
    }
    Ok(addresses)
}
pub(super) fn child(input: &[u8]) -> Result<Vec<u8>> {
    use std::net::ToSocketAddrs;
    let r: Request = serde_json::from_slice(input).map_err(|_| DesktopError("invalidEndpoint"))?;
    validate(&r.host, r.port)?;
    let addresses: std::collections::BTreeSet<_> = (r.host.as_str(), r.port)
        .to_socket_addrs()
        .map_err(|_| DesktopError("resolverUnavailable"))?
        .take(17)
        .collect();
    if addresses.is_empty()
        || addresses.len() > 16
        || addresses
            .iter()
            .any(|a| !super::catalog::public_address(a.ip()))
    {
        return Err(DesktopError("invalidEndpoint"));
    }
    serde_json::to_vec(&addresses).map_err(|_| DesktopError("resolverUnavailable"))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancelled_resolution_is_distinct_and_starts_no_process() {
        assert!(matches!(
            resolve("api.example.test", 443, &|| true),
            Err(DesktopError("staleGeneration"))
        ));
    }
    #[test]
    fn invalid_host_is_rejected_before_process() {
        assert!(matches!(
            resolve("bad host", 443, &|| false),
            Err(DesktopError("invalidEndpoint"))
        ));
    }
}
