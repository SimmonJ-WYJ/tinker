//! 同正式 React UI 的独立宿主；只拥有新 marker 根与本进程 mock。
use crate::{
    formal_commands::{self, FormalState},
    formal_host::FormalHost,
    formal_menu,
    formal_platform::{
        HostEnvironment, TrustedRoot, SYNTHETIC_PROFILE, SYNTHETIC_TOOLS, TOOLS_APPLICATION_ID,
    },
};
use std::{
    sync::{atomic::Ordering, mpsc},
    thread,
    time::Duration,
};
use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
fn environment(window: &tauri::WebviewWindow) -> HostEnvironment {
    HostEnvironment::new(
        if cfg!(target_os = "macos") {
            "darwin"
        } else if cfg!(windows) {
            "win32"
        } else {
            "linux"
        },
        window
            .theme()
            .is_ok_and(|theme| theme == tauri::Theme::Dark),
        window.is_fullscreen().unwrap_or(false),
    )
    .expect("宿主平台固定")
}
#[derive(Clone, Copy)]
pub struct LaunchProbe {
    pub initialization_script: &'static str,
    pub route_event: fn(&crate::formal_agent::protocol::EventEnvelope) -> bool,
    pub ready: fn(tauri::WebviewWindow),
}
pub fn run(
    context: tauri::Context<tauri::Wry>,
    expected_identifier: &str,
    probe: Option<LaunchProbe>,
) {
    run_mode(context, expected_identifier, probe, false)
}
pub fn run_tools(
    context: tauri::Context<tauri::Wry>,
    expected_identifier: &str,
    probe: Option<LaunchProbe>,
) {
    assert_eq!(
        expected_identifier, TOOLS_APPLICATION_ID,
        "工具入口身份不匹配"
    );
    run_mode(context, expected_identifier, probe, true)
}
fn run_mode(
    context: tauri::Context<tauri::Wry>,
    expected_identifier: &str,
    probe: Option<LaunchProbe>,
    tools: bool,
) {
    validate_config(context.config(), expected_identifier)
        .expect("编译配置不匹配，拒绝创建窗口或数据");
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![formal_commands::formal_request, formal_commands::formal_window])
        .on_menu_event(formal_menu::event)
        .setup(move |app| {
            // QA 仅接受系统 tmp 的严格 marker 根；默认仅使用本 identifier 的 appData。
            let (root, fresh) = if let Some(path) = std::env::var_os(if tools {"TINKER_TOOLS_PREVIEW_ROOT"} else {"TINKER_FORMAL_PREVIEW_ROOT"}) {
                let path = std::path::PathBuf::from(path);
                let fresh = !path.exists();
                (if tools {if fresh {TrustedRoot::create_tools_temporary(&path)} else {TrustedRoot::open_tools_temporary(&path)}} else if fresh { TrustedRoot::create_temporary(&path) } else { TrustedRoot::open_temporary(&path) }?,fresh)
            } else {
                let parent = app.path().app_local_data_dir()?;
                if !parent.exists() { let mut builder=std::fs::DirBuilder::new(); #[cfg(unix)] { use std::os::unix::fs::DirBuilderExt; builder.mode(0o700); } builder.create(&parent)?; }
                let parent = parent.canonicalize()?;
                let fresh = !parent.join(if tools {SYNTHETIC_TOOLS} else {SYNTHETIC_PROFILE}).exists();
                (if tools {if fresh {TrustedRoot::create_tools_app_data(&parent)} else {TrustedRoot::open_tools_app_data(&parent)}} else if fresh {TrustedRoot::create_app_data(&parent)} else {TrustedRoot::open_app_data(&parent)}?,fresh)
            };
            let window = WebviewWindowBuilder::new(app,"main",WebviewUrl::App("index.html".into()))
                .title(if tools {"Tinker Tools Preview"} else {"Tinker Formal Preview"}).inner_size(1400.0,900.0).min_inner_size(1024.0,720.0)
                .title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true)
                .initialization_script(probe.map(|p|p.initialization_script).unwrap_or(""))
                .on_navigation(formal_commands::local_origin)
                .on_new_window(|_,_| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            let host = if tools {FormalHost::open_tools(&root,environment(&window))?} else {FormalHost::open(&root,environment(&window))?};
            if fresh {
                // 预配置合成验收 profile：实际持久化 skip，不虚构真实服务已连接。
                let boot = host.command("main",serde_json::json!({"command":"bootstrap"}))?.wait(Duration::from_secs(5))?;
                host.command("main",serde_json::json!({"command":"invoke","generation":boot["generation"],"channel":"onboarding-spotlight:skip","args":[],"mutation":{"mutationId":"synthetic-fixture-onboarding-v1","expectedRevision":boot["platformSnapshot"]["revision"]}}))?.wait(Duration::from_secs(5))?;
            }
            let state=FormalState::new(host);
            app.manage(state.clone());
            let (menu_tx,menu_rx)=mpsc::sync_channel(64);
            *state.snapshots.lock().expect("菜单锁")=Some(menu_tx);
            let menu_handle=app.handle().clone();
            thread::Builder::new().name("formal-menu".into()).spawn(move || {
                let mut revision=0_u64;
                while let Ok(snapshot)=menu_rx.recv() {
                    let next=snapshot["revision"].as_u64().unwrap_or(0);
                    if next<revision {continue;} revision=next;
                    let handle=menu_handle.clone();
                    let _=menu_handle.run_on_main_thread(move || formal_menu::refresh(&handle,&snapshot));
                }
            })?;
            let handle=app.handle().clone();
            let pump_state=state.clone();
            thread::Builder::new().name("formal-events".into()).spawn(move || loop {
                let event = { let guard=pump_state.host.lock().expect("宿主锁"); let Some(host)=guard.as_ref() else {break}; host.next_event(Duration::ZERO) };
                if let Some(event)=event { if probe.is_some_and(|p| !(p.route_event)(&event)) {continue;}
                    if handle.emit_to("main","formal:event",event).is_err() { break; } } else {thread::sleep(Duration::from_millis(5));}
            })?;
            // 原生环境单 lane：同 revision 的系统事实也按递增序号发布。
            let (tx,rx)=mpsc::sync_channel(1);
            let latest_environment=std::sync::Arc::new(std::sync::Mutex::new(None));
            let pending_environment=latest_environment.clone();
            let env_handle=app.handle().clone();
            let env_state=state.clone();
            thread::Builder::new().name("formal-environment".into()).spawn(move || {
                while rx.recv().is_ok() {
                    let Some(environment)=pending_environment.lock().expect("环境锁").take() else {continue};
                    let result=env_state.environment(environment).and_then(|(pending,sequence)| pending.wait(Duration::from_secs(5)).map(|snapshot| (snapshot,sequence)).map_err(Into::into));
                    if let Ok((snapshot,sequence))=result { let _=env_handle.emit_to("main","formal:event",serde_json::json!({"kind":"environment","sequence":sequence,"snapshot":snapshot})); }
                }
            })?;
            let event_window=window.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::CloseRequested {api,..} => { if !state.approved_close.load(Ordering::SeqCst) {api.prevent_close(); formal_commands::action(event_window.app_handle(),"close");} },
                WindowEvent::ThemeChanged(_) | WindowEvent::Resized(_) => {*latest_environment.lock().expect("环境锁")=Some(environment(&event_window)); let _=tx.try_send(());},
                _=>{}
            });
            if let Some(probe) = probe { (probe.ready)(window.clone()); }
            Ok(())
        })
        .build(context)
        .expect("正式预览启动失败");
    app.run(|handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            if !handle
                .state::<FormalState>()
                .approved_close
                .load(Ordering::SeqCst)
            {
                api.prevent_exit();
                formal_commands::action(handle, "close");
            }
        }
    });
}

fn validate_config(config: &tauri::Config, expected_identifier: &str) -> Result<(), &'static str> {
    if config.identifier != expected_identifier || !config.app.windows.is_empty() {
        return Err("wrongNativeConfiguration");
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_lab_or_cross_binary_configuration_before_window_creation() {
        let lab: tauri::Config = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let formal: tauri::Config =
            serde_json::from_str(include_str!("../tauri.formal.conf.json")).unwrap();
        let qa: tauri::Config =
            serde_json::from_str(include_str!("../tauri.qa.conf.json")).unwrap();
        let tools: tauri::Config =
            serde_json::from_str(include_str!("../tauri.tools.conf.json")).unwrap();
        assert!(validate_config(&formal, TOOLS_APPLICATION_ID).is_err());
        assert!(validate_config(&tools, TOOLS_APPLICATION_ID).is_ok());
        assert!(validate_config(&tools, "com.tinker.formal-preview").is_err());
        assert_eq!(tools.build.frontend_dist, formal.build.frontend_dist);
        assert_eq!(tools.app.security.csp, formal.app.security.csp);
        assert!(validate_config(&lab, "com.tinker.formal-preview").is_err());
        assert!(validate_config(&qa, "com.tinker.formal-preview").is_err());
        assert!(validate_config(&formal, "com.tinker.formal-native-qa").is_err());
        assert!(validate_config(&formal, "com.tinker.formal-preview").is_ok());
        assert!(validate_config(&qa, "com.tinker.formal-native-qa").is_ok());
    }
}
