//! 目录与聊天共用端点授权；域名地址必须来自有界owned resolver。
use super::catalog::{public_address, EndpointPolicy};
use crate::desktop_runtime::protocol::{DesktopError, Result};
use std::net::{IpAddr, SocketAddr};
pub(crate) struct PreparedEndpoint {
    pub base: String,
    pub pins: Vec<SocketAddr>,
}
pub(crate) fn prepare(
    policy: &EndpointPolicy,
    base: &str,
    cancelled: impl Fn() -> bool,
) -> Result<PreparedEndpoint> {
    let base = policy.normalize(base)?;
    if cancelled() {
        return Err(DesktopError("staleGeneration"));
    }
    let u = reqwest::Url::parse(&base).map_err(|_| DesktopError("invalidEndpoint"))?;
    let host = u
        .host_str()
        .ok_or(DesktopError("invalidEndpoint"))?
        .trim_matches(['[', ']']);
    let pins = if host.parse::<IpAddr>().is_ok() {
        Vec::new()
    } else {
        let p = super::resolver::resolve(
            host,
            u.port_or_known_default()
                .ok_or(DesktopError("invalidEndpoint"))?,
            &cancelled,
        )?;
        if p.is_empty() || p.len() > 16 || p.iter().any(|p| !public_address(p.ip())) {
            return Err(DesktopError("invalidEndpoint"));
        }
        p
    };
    if cancelled() {
        return Err(DesktopError("staleGeneration"));
    }
    Ok(PreparedEndpoint { base, pins })
}
pub(crate) struct RejectDns;
impl reqwest::dns::Resolve for RejectDns {
    fn resolve(&self, _: reqwest::dns::Name) -> reqwest::dns::Resolving {
        Box::pin(async { Err(std::io::Error::other("dnsDisabled").into()) })
    }
}
