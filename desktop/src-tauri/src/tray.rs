//! System tray integration for the A.stand desktop shell.
//!
//! The tray is the primary control surface: closing the window only hides it, and
//! quitting from the tray is the one action that stops the daemon we own.

use std::process::Command;

use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::daemon::{self, DaemonInfo};

pub const TRAY_ID: &str = "main";
const MENU_SHOW: &str = "show";
const MENU_STATUS: &str = "status";
const MENU_BROWSER: &str = "browser";
const MENU_QUIT: &str = "quit";

/// Tray menu handles that need live updates once the daemon is ready.
pub struct TrayState {
    pub status: MenuItem<Wry>,
    pub browser: MenuItem<Wry>,
}

/// Build the tray icon and its menu. Called from `setup` before the daemon boots.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id(MENU_SHOW, "打开 A.stand").build(app)?;
    let status = MenuItemBuilder::with_id(MENU_STATUS, "网关 · 正在启动…")
        .enabled(false)
        .build(app)?;
    let browser = MenuItemBuilder::with_id(MENU_BROWSER, "在浏览器中打开")
        .enabled(false)
        .build(app)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id(MENU_QUIT, "退出 A.stand（停止后台）").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&show, &status, &browser])
        .item(&separator)
        .item(&quit)
        .build()?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("A.stand · 正在启动…")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_SHOW => show_main(app),
            MENU_BROWSER => open_in_browser(app),
            MENU_QUIT => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    } else if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")) {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    app.manage(TrayState { status, browser });
    Ok(())
}

/// Daemon is ready: reflect the real gateway in the tooltip and the info row.
pub fn apply_ready(app: &AppHandle, info: &DaemonInfo) {
    let gateway = info.gateway_label();
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(format!("A.stand · {gateway}")));
    }
    set_status(app, &format!("网关 {gateway} · 运行中"));
    set_browser_enabled(app, true);
}

/// Daemon failed to start: surface it in the tray without killing the shell.
pub fn apply_failed(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some("A.stand · 守护进程未运行".to_string()));
    }
    set_status(app, "网关未启动 · 请查看窗口内的修复提示");
    set_browser_enabled(app, false);
}

fn set_status(app: &AppHandle, text: &str) {
    if let Some(state) = app.try_state::<TrayState>() {
        let _ = state.status.set_text(text);
    }
}

fn set_browser_enabled(app: &AppHandle, enabled: bool) {
    if let Some(state) = app.try_state::<TrayState>() {
        let _ = state.browser.set_enabled(enabled);
    }
}

fn show_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn toggle_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    if visible && focused {
        let _ = window.hide();
        return;
    }
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn open_in_browser(app: &AppHandle) {
    let Some(info) = daemon::current_info(app) else {
        return;
    };
    let url = info.console_url();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("cmd")
            .args(["/C", "start", "", &url])
            .creation_flags(0x0800_0000)
            .spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("xdg-open").arg(&url).spawn();
    }
}

fn quit_app(app: &AppHandle) {
    if let Some(state) = app.try_state::<daemon::DaemonState>() {
        daemon::kill_owned(&state);
    }
    app.exit(0);
}
