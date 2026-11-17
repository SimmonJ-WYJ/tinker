//! 运行中代码身份验证；静态路径和磁盘签名资料都不能单独授权helper。
use crate::desktop_runtime::protocol::{DesktopError, Result};
use std::{ffi::c_void, ptr};
type Cf = *const c_void;
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;
    fn CFDictionaryCreateMutable(a: Cf, n: isize, k: Cf, v: Cf) -> Cf;
    fn CFDictionarySetValue(d: Cf, k: Cf, v: Cf);
    fn CFDictionaryGetValue(d: Cf, k: Cf) -> Cf;
    fn CFNumberCreate(a: Cf, t: i32, value: *const c_void) -> Cf;
    fn CFStringCreateWithBytes(a: Cf, b: *const u8, n: isize, encoding: u32, external: u8) -> Cf;
    fn CFDataGetLength(d: Cf) -> isize;
    fn CFDataGetBytePtr(d: Cf) -> *const u8;
    fn CFDataGetTypeID() -> usize;
    fn CFGetTypeID(d: Cf) -> usize;
    fn CFRelease(d: Cf);
}
#[link(name = "Security", kind = "framework")]
unsafe extern "C" {
    static kSecGuestAttributePid: Cf;
    static kSecCodeInfoUnique: Cf;
    fn SecCodeCopySelf(flags: u32, code: *mut Cf) -> i32;
    fn SecCodeCopyGuestWithAttributes(host: Cf, attrs: Cf, flags: u32, code: *mut Cf) -> i32;
    fn SecCodeCheckValidity(code: Cf, flags: u32, requirement: Cf) -> i32;
    fn SecCodeCopySigningInformation(code: Cf, flags: u32, info: *mut Cf) -> i32;
    fn SecCodeCopyDesignatedRequirement(code: Cf, flags: u32, requirement: *mut Cf) -> i32;
    fn SecRequirementCreateWithString(text: Cf, flags: u32, requirement: *mut Cf) -> i32;
}
unsafe extern "C" {
    fn getppid() -> i32;
    fn proc_pidpath(pid: i32, buffer: *mut c_void, size: u32) -> i32;
}
struct Owned(Cf);
impl Drop for Owned {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) }
    }
}
fn owned(p: Cf) -> Result<Owned> {
    if p.is_null() {
        Err(DesktopError("helperUnauthorized"))
    } else {
        Ok(Owned(p))
    }
}
fn status(code: i32) -> Result<()> {
    if code == 0 {
        Ok(())
    } else {
        Err(DesktopError("helperUnauthorized"))
    }
}
fn output(call: impl FnOnce(*mut Cf) -> i32) -> Result<Owned> {
    let mut p = ptr::null();
    status(call(&mut p))?;
    owned(p)
}
pub(super) fn same_code(pid: i32) -> Result<()> {
    if pid <= 1 {
        return Err(DesktopError("helperUnauthorized"));
    }
    let mut path = [0u8; 4096];
    let size = unsafe { proc_pidpath(pid, path.as_mut_ptr().cast(), path.len() as u32) };
    if size <= 0 {
        return Err(DesktopError("helperUnauthorized"));
    }
    let len = path
        .iter()
        .position(|b| *b == 0)
        .ok_or(DesktopError("helperUnauthorized"))?;
    use std::os::unix::ffi::OsStrExt;
    let executable = std::env::current_exe().map_err(|_| DesktopError("helperUnauthorized"))?;
    if std::path::Path::new(std::ffi::OsStr::from_bytes(&path[..len])) != executable {
        return Err(DesktopError("helperUnauthorized"));
    }
    let own = output(|p| unsafe { SecCodeCopySelf(0, p) })?;
    status(unsafe { SecCodeCheckValidity(own.0, 0, ptr::null()) })?;
    let information = output(|p| unsafe { SecCodeCopySigningInformation(own.0, 0, p) })?;
    let hash = unsafe { CFDictionaryGetValue(information.0, kSecCodeInfoUnique) };
    if hash.is_null() || unsafe { CFGetTypeID(hash) != CFDataGetTypeID() } {
        return Err(DesktopError("helperUnauthorized"));
    }
    let length = unsafe { CFDataGetLength(hash) };
    let bytes = unsafe { CFDataGetBytePtr(hash) };
    if !(20..=64).contains(&length) || bytes.is_null() {
        return Err(DesktopError("helperUnauthorized"));
    }
    let hex = unsafe { std::slice::from_raw_parts(bytes, length as usize) }
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let requirement = format!("cdhash H\"{hex}\"");
    let text = owned(unsafe {
        CFStringCreateWithBytes(
            ptr::null(),
            requirement.as_ptr(),
            requirement.len() as isize,
            0x08000100,
            0,
        )
    })?;
    let unique = output(|p| unsafe { SecRequirementCreateWithString(text.0, 0, p) })?;
    let designated = output(|p| unsafe { SecCodeCopyDesignatedRequirement(own.0, 0, p) })?;
    let attributes = owned(unsafe {
        CFDictionaryCreateMutable(
            ptr::null(),
            0,
            ptr::addr_of!(kCFTypeDictionaryKeyCallBacks),
            ptr::addr_of!(kCFTypeDictionaryValueCallBacks),
        )
    })?;
    let number = owned(unsafe { CFNumberCreate(ptr::null(), 9, ptr::addr_of!(pid).cast()) })?;
    unsafe { CFDictionarySetValue(attributes.0, kSecGuestAttributePid, number.0) };
    let guest =
        output(|p| unsafe { SecCodeCopyGuestWithAttributes(ptr::null(), attributes.0, 0, p) })?;
    status(unsafe { SecCodeCheckValidity(guest.0, 0, designated.0) })?;
    status(unsafe { SecCodeCheckValidity(guest.0, 0, unique.0) })
}
pub(super) fn parent() -> Result<i32> {
    use std::os::{fd::FromRawFd, unix::fs::FileTypeExt};
    for fd in [0, 1] {
        let f = std::mem::ManuallyDrop::new(unsafe { std::fs::File::from_raw_fd(fd) });
        if !f
            .metadata()
            .map_err(|_| DesktopError("helperUnauthorized"))?
            .file_type()
            .is_fifo()
        {
            return Err(DesktopError("helperUnauthorized"));
        }
    }
    let parent = unsafe { getppid() };
    same_code(parent)?;
    if unsafe { getppid() } != parent {
        return Err(DesktopError("helperUnauthorized"));
    }
    Ok(parent)
}
pub(super) fn recheck(parent: i32) -> Result<()> {
    if unsafe { getppid() } != parent {
        return Err(DesktopError("helperUnauthorized"));
    }
    same_code(parent)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn foreign_parent_fails_without_any_keychain_item_operation() {
        assert!(parent().is_err());
    }
    #[test]
    fn current_live_process_identity_validates_without_item_access() {
        same_code(std::process::id() as i32).expect("当前进程的动态签名必须可验证");
    }
}
