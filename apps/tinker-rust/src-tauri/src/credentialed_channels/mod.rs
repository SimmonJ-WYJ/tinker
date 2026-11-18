//! 独立凭据渠道目录；仅非秘密版本和引用可以进入公共快照。
pub mod catalog;
pub mod vault;
#[cfg(any(test, feature = "formal-native-qa"))]
pub mod vault_fake;
#[cfg(target_os = "macos")]
pub(crate) mod vault_macos;

#[cfg(target_os = "macos")]
pub(crate) mod auth_macos;
pub(crate) mod discovery;
pub(crate) mod endpoint;
pub mod process;
#[cfg(any(test, feature = "formal-native-qa"))]
pub(crate) mod qa;
pub(crate) mod resolver;
pub(crate) mod validation;
#[cfg(target_os = "macos")]
pub(crate) mod vault_host;
pub(crate) mod worker;

#[cfg(any(test, feature = "formal-native-qa"))]
mod qa_observations;
