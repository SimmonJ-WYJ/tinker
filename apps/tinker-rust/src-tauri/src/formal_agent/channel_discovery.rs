//! 目录探测在单独的有界槽执行；不会阻塞 actor 的 Stop、权限或关闭。
use super::{actor::Actor, Reply};
use crate::{
    desktop_runtime::protocol::{DesktopError, Result},
    formal_platform::MOCK_KEY,
};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
impl Actor {
    pub(super) fn channel_discovery(
        &mut self,
        c: &str,
        args: &[Value],
        reply: &Reply,
    ) -> Result<Option<Value>> {
        if args.len() != 1 {
            return Err(DesktopError("invalidParams"));
        }
        let (provider, base, models) = if matches!(c, "channel:decrypt-key" | "channel:test") {
            self.platform
                .synthetic_connection(args[0].as_str().ok_or(DesktopError("invalidParams"))?)?
        } else {
            let input = args[0].as_object().ok_or(DesktopError("invalidParams"))?;
            if input.keys().any(|k| {
                ![
                    "provider",
                    "baseUrl",
                    "apiKey",
                    "probeModel",
                    "imageProtocol",
                ]
                .contains(&k.as_str())
            }) {
                return Err(DesktopError("invalidParams"));
            }
            let list = self.platform.channels()?;
            let channel = list
                .as_array()
                .ok_or(DesktopError("invalidReply"))?
                .iter()
                .find(|p| {
                    p["baseUrl"] == args[0]["baseUrl"] && p["provider"] == args[0]["provider"]
                })
                .ok_or(DesktopError("invalidParams"))?;
            let connection = self.platform.synthetic_connection(
                channel["id"].as_str().ok_or(DesktopError("invalidReply"))?,
            )?;
            if args[0]["apiKey"] != MOCK_KEY
                || input
                    .get("imageProtocol")
                    .is_some_and(|v| v != "openai-images")
            {
                return Err(DesktopError("invalidParams"));
            }
            if c == "channel:test-direct"
                && !args[0]["probeModel"]
                    .as_str()
                    .is_some_and(|id| connection.2.iter().any(|m| m == id))
            {
                return Err(DesktopError("modelNotFound"));
            }
            connection
        };
        if c == "channel:decrypt-key" {
            return Ok(Some(json!({"value":MOCK_KEY})));
        }
        if provider != "custom-openai" {
            return Err(DesktopError("unsupported"));
        }
        if self
            .probe_worker
            .as_ref()
            .is_some_and(|worker| !worker.is_finished())
        {
            return Err(DesktopError("hostBusy"));
        }
        if let Some(worker) = self.probe_worker.take() {
            let _ = worker.join();
        }
        let epoch = self.probe_epoch.clone();
        let expected = epoch.load(Ordering::Acquire);
        let reply = reply.clone();
        let fetch = c == "channel:fetch-models";
        let worker = std::thread::Builder::new()
            .name("formal-catalog".into())
            .spawn(move || {
                let result = crate::formal_mock::discovery::catalog(&base, &models, || {
                    epoch.load(Ordering::Acquire) != expected
                })
                .and_then(|models| {
                    if epoch.load(Ordering::Acquire) != expected {
                        return Err(DesktopError("staleGeneration"));
                    }
                    let value = if fetch {
                        json!({"success":true,"message":"catalogValidated","models":models})
                    } else {
                        json!({"success":true,"message":"catalogValidated"})
                    };
                    Ok(json!({"value":value}))
                });
                let _ = reply.send(result);
            });
        self.probe_worker = Some(worker.map_err(|_| DesktopError("hostUnavailable"))?);
        Ok(None)
    }
    pub(super) fn cancel_probe(&mut self) {
        self.probe_epoch.fetch_add(1, Ordering::AcqRel);
        if let Some(worker) = self.probe_worker.take() {
            let _ = worker.join();
        }
    }
}
