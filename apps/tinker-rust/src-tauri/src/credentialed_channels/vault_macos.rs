//! Security.framework适配器仅供已认证的owned helper；本阶段没有创建证明或执行入口。
#![allow(dead_code)]
use super::{
    catalog::opaque_reference,
    vault::{CredentialVault, Secret, VaultScope},
};
use crate::desktop_runtime::protocol::{DesktopError, Result};
use std::{ffi::c_void, ptr};
type Cf = *const c_void;
/// 私有字段且无构造器：实际宿主任务必须先实现父进程认证与私有管道握手。
pub(crate) struct OwnedHelperProof {
    _private: (),
}
pub(crate) struct MacosVault {
    _proof: OwnedHelperProof,
}
impl MacosVault {
    pub(crate) fn in_owned_helper(proof: OwnedHelperProof) -> Self {
        Self { _proof: proof }
    }
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;
    static kCFBooleanFalse: Cf;
    static kCFBooleanTrue: Cf;
    fn CFDictionaryCreateMutable(a: Cf, n: isize, k: Cf, v: Cf) -> Cf;
    fn CFDictionarySetValue(d: Cf, k: Cf, v: Cf);
    fn CFDictionaryGetValue(d: Cf, k: Cf) -> Cf;
    fn CFStringCreateWithBytes(a: Cf, b: *const u8, n: isize, encoding: u32, external: u8) -> Cf;
    fn CFStringGetCString(s: Cf, b: *mut i8, n: isize, encoding: u32) -> u8;
    fn CFStringGetTypeID() -> usize;
    fn CFDataCreate(a: Cf, b: *const u8, n: isize) -> Cf;
    fn CFDataGetLength(d: Cf) -> isize;
    fn CFDataGetBytePtr(d: Cf) -> *const u8;
    fn CFDataGetTypeID() -> usize;
    fn CFArrayGetCount(a: Cf) -> isize;
    fn CFArrayGetValueAtIndex(a: Cf, n: isize) -> Cf;
    fn CFArrayGetTypeID() -> usize;
    fn CFDictionaryGetTypeID() -> usize;
    fn CFGetTypeID(a: Cf) -> usize;
    fn CFRelease(a: Cf);
}
#[link(name = "Security", kind = "framework")]
unsafe extern "C" {
    static kSecClass: Cf;
    static kSecClassGenericPassword: Cf;
    static kSecAttrService: Cf;
    static kSecAttrAccount: Cf;
    static kSecAttrSynchronizable: Cf;
    static kSecAttrAccessible: Cf;
    static kSecAttrAccessibleWhenUnlockedThisDeviceOnly: Cf;
    static kSecUseDataProtectionKeychain: Cf;
    static kSecUseAuthenticationUI: Cf;
    static kSecUseAuthenticationUIFail: Cf;
    static kSecValueData: Cf;
    static kSecReturnData: Cf;
    static kSecReturnAttributes: Cf;
    static kSecMatchLimit: Cf;
    static kSecMatchLimitOne: Cf;
    static kSecMatchLimitAll: Cf;
    fn SecItemAdd(q: Cf, result: *mut Cf) -> i32;
    fn SecItemCopyMatching(q: Cf, result: *mut Cf) -> i32;
    fn SecItemDelete(q: Cf) -> i32;
}
struct Owned(Cf);
impl Owned {
    fn new(value: Cf) -> Result<Self> {
        if value.is_null() {
            Err(DesktopError("vaultUnavailable"))
        } else {
            Ok(Self(value))
        }
    }
}
impl Drop for Owned {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) }
    }
}
fn string(value: &str) -> Result<Owned> {
    Owned::new(unsafe {
        CFStringCreateWithBytes(
            ptr::null(),
            value.as_ptr(),
            value.len() as isize,
            0x08000100,
            0,
        )
    })
}
fn query(scope: &VaultScope, reference: Option<&str>) -> Result<Owned> {
    let service = string(&scope.service())?;
    let q = Owned::new(unsafe {
        CFDictionaryCreateMutable(
            ptr::null(),
            0,
            ptr::addr_of!(kCFTypeDictionaryKeyCallBacks),
            ptr::addr_of!(kCFTypeDictionaryValueCallBacks),
        )
    })?;
    unsafe {
        CFDictionarySetValue(q.0, kSecClass, kSecClassGenericPassword);
        CFDictionarySetValue(q.0, kSecAttrService, service.0);
        CFDictionarySetValue(q.0, kSecAttrSynchronizable, kCFBooleanFalse);
        CFDictionarySetValue(q.0, kSecUseDataProtectionKeychain, kCFBooleanTrue);
        CFDictionarySetValue(q.0, kSecUseAuthenticationUI, kSecUseAuthenticationUIFail);
    }
    if let Some(reference) = reference {
        opaque_reference(reference)?;
        let account = string(reference)?;
        unsafe {
            CFDictionarySetValue(q.0, kSecAttrAccount, account.0);
        }
    }
    Ok(q)
}
fn status(value: i32) -> Result<()> {
    match value {
        0 => Ok(()),
        -25300 => Err(DesktopError("credentialMissing")),
        -25299 => Err(DesktopError("credentialReferenceExists")),
        -25308 | -25293 | -128 => Err(DesktopError("vaultDenied")),
        _ => Err(DesktopError("vaultUnavailable")),
    }
}
impl CredentialVault for MacosVault {
    fn put(&self, scope: &VaultScope, reference: &str, secret: &Secret) -> Result<()> {
        if self.owned_references(scope)?.len() >= 144 {
            return Err(DesktopError("storageLimit"));
        }
        let q = query(scope, Some(reference))?;
        let data = secret.with_bytes(|b| {
            Owned::new(unsafe { CFDataCreate(ptr::null(), b.as_ptr(), b.len() as isize) })
        })?;
        unsafe {
            CFDictionarySetValue(q.0, kSecValueData, data.0);
            CFDictionarySetValue(
                q.0,
                kSecAttrAccessible,
                kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            );
        }
        status(unsafe { SecItemAdd(q.0, ptr::null_mut()) })
    }
    fn acquire(&self, scope: &VaultScope, reference: &str) -> Result<Secret> {
        let q = query(scope, Some(reference))?;
        unsafe {
            CFDictionarySetValue(q.0, kSecReturnData, kCFBooleanTrue);
            CFDictionarySetValue(q.0, kSecMatchLimit, kSecMatchLimitOne);
        }
        let mut result = ptr::null();
        status(unsafe { SecItemCopyMatching(q.0, &mut result) })?;
        let data = Owned::new(result)?;
        if unsafe { CFGetTypeID(data.0) != CFDataGetTypeID() } {
            return Err(DesktopError("vaultUnavailable"));
        }
        let length = unsafe { CFDataGetLength(data.0) };
        if !(1..=8192).contains(&length) {
            return Err(DesktopError("vaultUnavailable"));
        }
        let bytes = unsafe { CFDataGetBytePtr(data.0) };
        if bytes.is_null() {
            return Err(DesktopError("vaultUnavailable"));
        }
        Secret::new(unsafe { std::slice::from_raw_parts(bytes, length as usize) }.to_vec())
    }
    fn owned_references(&self, scope: &VaultScope) -> Result<Vec<String>> {
        let q = query(scope, None)?;
        unsafe {
            CFDictionarySetValue(q.0, kSecReturnAttributes, kCFBooleanTrue);
            CFDictionarySetValue(q.0, kSecMatchLimit, kSecMatchLimitAll);
        }
        let mut result = ptr::null();
        let code = unsafe { SecItemCopyMatching(q.0, &mut result) };
        if code == -25300 {
            return Ok(vec![]);
        }
        status(code)?;
        let array = Owned::new(result)?;
        if unsafe { CFGetTypeID(array.0) != CFArrayGetTypeID() } {
            return Err(DesktopError("vaultUnavailable"));
        }
        let count = unsafe { CFArrayGetCount(array.0) };
        if !(0..=144).contains(&count) {
            return Err(DesktopError("storageLimit"));
        }
        let mut refs = Vec::new();
        for index in 0..count {
            let entry = unsafe { CFArrayGetValueAtIndex(array.0, index) };
            if entry.is_null() || unsafe { CFGetTypeID(entry) != CFDictionaryGetTypeID() } {
                return Err(DesktopError("vaultUnavailable"));
            }
            let account = unsafe { CFDictionaryGetValue(entry, kSecAttrAccount) };
            if account.is_null() || unsafe { CFGetTypeID(account) != CFStringGetTypeID() } {
                return Err(DesktopError("vaultUnavailable"));
            }
            let mut bytes = [0i8; 33];
            if unsafe { CFStringGetCString(account, bytes.as_mut_ptr(), 33, 0x08000100) } == 0 {
                return Err(DesktopError("vaultUnavailable"));
            }
            let reference = std::str::from_utf8(unsafe {
                std::slice::from_raw_parts(bytes.as_ptr().cast::<u8>(), 32)
            })
            .map_err(|_| DesktopError("vaultUnavailable"))?
            .to_string();
            opaque_reference(&reference)?;
            refs.push(reference);
        }
        Ok(refs)
    }
    fn remove(&self, scope: &VaultScope, reference: &str) -> Result<()> {
        let q = query(scope, Some(reference))?;
        status(unsafe { SecItemDelete(q.0) })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn framework_status_is_static_and_fails_closed_without_calling_framework() {
        assert!(matches!(
            status(-25300),
            Err(DesktopError("credentialMissing"))
        ));
        assert!(matches!(status(-25308), Err(DesktopError("vaultDenied"))));
        assert!(matches!(
            status(-25299),
            Err(DesktopError("credentialReferenceExists"))
        ));
        assert!(matches!(status(-1), Err(DesktopError("vaultUnavailable"))));
    }
}
