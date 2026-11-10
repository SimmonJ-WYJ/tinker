//! 回环测试服务的有界请求读取，避免未读正文影响断连断言。
use std::{io::Read, net::TcpStream, time::Duration};
pub fn read_request(socket: &mut TcpStream) -> Vec<u8> {
    read_request_with_limit(socket, 16384)
}
pub fn read_request_with_limit(socket: &mut TcpStream, limit: usize) -> Vec<u8> {
    socket
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let mut bytes = Vec::new();
    let mut buf = [0; 4096];
    loop {
        let count = socket.read(&mut buf).unwrap();
        assert!(count > 0);
        bytes.extend_from_slice(&buf[..count]);
        assert!(bytes.len() <= limit);
        if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
            let headers = std::str::from_utf8(&bytes[..end]).unwrap();
            let length = headers
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length: ")
                        .map(|n| n.parse::<usize>().unwrap())
                })
                .unwrap_or(0);
            if bytes.len() >= end + 4 + length {
                return bytes;
            }
        }
    }
}
