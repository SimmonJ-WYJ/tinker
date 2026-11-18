//! 原Test/Refresh参数只映射两个显式codec；新输入只作临时凭据，不进入stage。
use crate::{
    chat_http::HttpProtocol,
    credentialed_channels::{
        catalog::{Catalog, EndpointPolicy},
        vault::Secret,
        worker::Known,
    },
    desktop_runtime::protocol::{DesktopError, Result},
};
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::Arc};
pub(super) fn probe(
    c: &str,
    args: &[Value],
    catalog: &Catalog,
    keys: &BTreeMap<String, Arc<Secret>>,
    policy: &EndpointPolicy,
    known: &Known,
    cancelled: &impl Fn() -> bool,
) -> Result<Value> {
    if args.len() != 1 {
        return Err(DesktopError("invalidParams"));
    }
    let (base, protocol, key) = if let Some(id) = args[0].as_str() {
        let revision = catalog
            .current()
            .find(|r| r.channel.id == id)
            .ok_or(DesktopError("channelNotFound"))?;
        (
            revision.channel.base_url.clone(),
            revision.channel.protocol,
            keys.get(&revision.credential_ref)
                .cloned()
                .ok_or(DesktopError("credentialMissing"))?,
        )
    } else {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Input {
            provider: String,
            base_url: String,
            api_key: String,
            #[serde(default)]
            probe_model: Option<String>,
            #[serde(default)]
            image_protocol: Option<String>,
        }
        let input: Input =
            serde_json::from_value(args[0].clone()).map_err(|_| DesktopError("invalidParams"))?;
        let protocol = match input.provider.as_str() {
            "custom-openai" => HttpProtocol::OpenaiChat,
            "anthropic" | "custom-anthropic" => HttpProtocol::AnthropicMessages,
            _ => return Err(DesktopError("unsupported")),
        };
        if input.image_protocol.is_some_and(|p| p != "openai-images") {
            return Err(DesktopError("unsupported"));
        }
        if let Some(model) = input.probe_model {
            crate::desktop_runtime::protocol::model_id(&model)?;
        }
        let base = policy.normalize(&input.base_url)?;
        if matches!(policy, EndpointPolicy::OwnedQa(_)) {
            #[cfg(any(test, feature = "formal-native-qa"))]
            if ![
                crate::credentialed_channels::vault_fake::QA_SECRET_ONE,
                crate::credentialed_channels::vault_fake::QA_SECRET_TWO,
            ]
            .contains(&input.api_key.as_str())
            {
                return Err(DesktopError("invalidCredential"));
            }
            #[cfg(not(any(test, feature = "formal-native-qa")))]
            return Err(DesktopError("unsupported"));
        }
        (
            base,
            protocol,
            Arc::new(Secret::new(input.api_key.into_bytes())?),
        )
    };
    let models = crate::credentialed_channels::discovery::catalog(
        policy, &base, protocol, &key, known, cancelled,
    )?;
    Ok(if c == "channel:fetch-models" {
        json!({"success":true,"message":"catalogValidated","models":models})
    } else {
        json!({"success":true,"message":"catalogValidated"})
    })
}
