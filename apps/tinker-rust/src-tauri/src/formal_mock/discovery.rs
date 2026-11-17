//! 只接收由宿主连接推导的端点；无环境代理、重定向或生成请求。
use crate::{
    desktop_runtime::protocol::{DesktopError, Result},
    formal_platform::MOCK_KEY,
};
use serde_json::{json, Value};
use std::time::Duration;
const MAX_CATALOG: usize = 64 * 1024;
pub(crate) fn catalog(
    base: &str,
    known: &[String],
    cancelled: impl Fn() -> bool,
) -> Result<Vec<Value>> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| DesktopError("runtimeUnavailable"))?;
    rt.block_on(async {
        let request=tokio::time::timeout(Duration::from_secs(2), async {
            let client = reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(2))
                .build()
                .map_err(|_| DesktopError("catalogUnavailable"))?;
            let mut response = client
                .get(format!("{base}/models"))
                .bearer_auth(MOCK_KEY)
                .send()
                .await
                .map_err(|_| DesktopError("catalogUnavailable"))?;
            if !response.status().is_success()
                || response
                    .content_length()
                    .is_some_and(|n| n > MAX_CATALOG as u64)
            {
                return Err(DesktopError("catalogUnavailable"));
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| DesktopError("catalogUnavailable"))?
            {
                if bytes.len() + chunk.len() > MAX_CATALOG {
                    return Err(DesktopError("catalogUnavailable"));
                }
                bytes.extend_from_slice(&chunk);
            }
            let value: Value =
                serde_json::from_slice(&bytes).map_err(|_| DesktopError("catalogUnavailable"))?;
            let data = value["data"]
                .as_array()
                .filter(|a| a.len() == known.len())
                .ok_or(DesktopError("catalogUnavailable"))?;
            if known
                .iter()
                .any(|id| data.iter().filter(|m| m["id"] == *id).count() != 1)
            {
                return Err(DesktopError("catalogUnavailable"));
            }
            Ok(known
                .iter()
                .map(|id| json!({"id":id,"name":id,"enabled":true}))
                .collect())
        })
        ;
        tokio::select! {
            result=request=>result.map_err(|_|DesktopError("catalogUnavailable"))?,
            ()=async {while !cancelled() {tokio::time::sleep(Duration::from_millis(10)).await;}}=>Err(DesktopError("staleGeneration")),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
        time::Instant,
    };
    fn fixture(response: Vec<u8>, delay: Duration) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let worker = thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            s.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
            let mut b = [0; 2048];
            let n = s.read(&mut b).unwrap();
            assert!(b[..n].starts_with(b"GET /v1/models HTTP/1.1"));
            assert!(String::from_utf8_lossy(&b[..n]).contains(MOCK_KEY));
            thread::sleep(delay);
            let _ = s.write_all(&response);
        });
        (url, worker)
    }
    #[test]
    fn redirects_unknown_catalog_and_response_bounds_fail_closed() {
        for response in [
            b"HTTP/1.1 302 Found\r\nLocation: https://example.com\r\nContent-Length: 0\r\n\r\n"
                .to_vec(),
            b"HTTP/1.1 200 OK\r\nContent-Length: 65537\r\n\r\n".to_vec(),
            b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n{\"data\":[]}".to_vec(),
            [
                b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".as_slice(),
                &vec![b'x'; 65537],
            ]
            .concat(),
        ] {
            let (url, worker) = fixture(response, Duration::ZERO);
            assert_eq!(
                catalog(&url, &["local-mock-a".into()], || false)
                    .unwrap_err()
                    .0,
                "catalogUnavailable"
            );
            worker.join().unwrap();
        }
    }
    #[test]
    fn total_timeout_is_bounded() {
        let (url, worker) = fixture(Vec::new(), Duration::from_millis(2200));
        let start = Instant::now();
        assert_eq!(
            catalog(&url, &["local-mock-a".into()], || false)
                .unwrap_err()
                .0,
            "catalogUnavailable"
        );
        assert!(start.elapsed() < Duration::from_millis(2150));
        worker.join().unwrap();
    }
}
