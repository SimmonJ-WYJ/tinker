//! 独立凭据渠道目录；仅非秘密版本和引用可以进入公共快照。
pub mod catalog;
pub mod vault;
#[cfg(any(test, feature = "formal-native-qa"))]
pub mod vault_fake;
#[cfg(target_os = "macos")]
pub(crate) mod vault_macos;
