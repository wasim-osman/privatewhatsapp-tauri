#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use std::io::Write;

use tauri::menu::{Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Listener, Manager, WebviewUrl, WebviewWindowBuilder};

const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15";
const HOME_URL: &str = "https://web.whatsapp.com";

const HEARTBEAT_POLL: Duration = Duration::from_secs(10);
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Default)]
struct Options {
    ephemeral: bool,
    no_scripts: bool,
    no_retention: bool,
    debug: bool,
}

fn parse_options() -> Options {
    let mut o = Options::default();
    for arg in std::env::args().skip(1) {
        match arg.as_str() {
            "--ephemeral" => o.ephemeral = true,
            "--no-scripts" => o.no_scripts = true,
            "--no-retention" => o.no_retention = true,
            "--debug" => o.debug = true,
            _ => {}
        }
    }
    o
}

fn injection_bundle(opts: &Options) -> String {
    let mut bundle = String::new();
    if !opts.no_scripts {
        bundle.push_str(include_str!("../scripts/bridge.js"));
        bundle.push_str(include_str!("../scripts/heartbeat.js"));
        bundle.push_str(include_str!("../scripts/cleanup.js"));
        bundle.push_str(include_str!("../scripts/callstate.js"));
        if !opts.no_retention {
            bundle.push_str(include_str!("../scripts/retention.js"));
        }
    }
    if opts.debug {
        bundle.push_str(include_str!("../scripts/debug.js"));
    }
    bundle
}

fn now_stamp() -> String {
    format!("{:?}", std::time::SystemTime::now())
}

fn log_file() -> std::path::PathBuf {
    if let Ok(p) = std::env::var("PW_LOG_PATH") {
        return std::path::PathBuf::from(p);
    }
    if let Ok(p) = std::env::var("pw_log_file") {
        return std::path::PathBuf::from(p);
    }
    std::env::temp_dir().join("privatewhatsapp.log")
}

fn debug_log(_app: &AppHandle, text: &str) {
    let file = log_file();
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let line = format!("[{}] {}\n", now_stamp(), text);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&file) {
        let _ = f.write_all(line.as_bytes());
    }
}

struct Heartbeat {
    last: Mutex<Instant>,
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let reload = MenuItemBuilder::with_id("reload", "Reload")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let fullscreen = tauri::menu::PredefinedMenuItem::fullscreen(app, None)?;

    let app_menu = SubmenuBuilder::new(app, "PrivateWhatsapp")
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&reload)
        .item(&fullscreen)
        .build()?;

    Menu::with_items(app, &[&app_menu, &edit, &view])
}

fn main() {
    let opts = parse_options();

    tauri::Builder::default()
        .setup(move |app| {
            let o = opts.clone();
            let handle: AppHandle = app.handle().clone();

            let menu = build_menu(&handle)?;
            app.set_menu(menu)?;
            app.on_menu_event(|app_handle, event| {
                if event.id().as_ref() == "reload" {
                    if let Some(win) = app_handle.get_webview_window("main") {
                        let _ = win.reload();
                    }
                }
            });

            let mut builder = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(HOME_URL.parse().expect("home url")),
            )
            .title("PrivateWhatsapp")
            .inner_size(1280.0, 860.0)
            .zoom_hotkeys_enabled(true)
            .user_agent(USER_AGENT)
            .initialization_script(&injection_bundle(&o));

            if o.ephemeral {
                let dir = std::env::temp_dir().join(format!("pw-ephemeral-{}", std::process::id()));
                let _ = std::fs::create_dir_all(&dir);
                builder = builder.data_directory(dir);
            }

            let _window = builder.build().unwrap_or_else(|e| {
                debug_log(&handle, &format!("FAIL window build: {e}"));
                std::process::exit(1);
            });
            debug_log(&handle, "window built ok");

            // A smoke marker that the page (WhatsApp) actually loaded and the
            // injected scripts are running: toggled only via the heartbeat
            // event raised by heartbeat.js. Used by the automated CI test.
            let page_alive = Arc::new(AtomicBool::new(false));
            let heartbeat = Arc::new(Heartbeat { last: Mutex::new(Instant::now()) });

            {
                let hb = heartbeat.clone();
                let alive = page_alive.clone();
                let log_h = handle.clone();
                handle.listen("heartbeat", move |_| {
                    if let Ok(mut last) = hb.last.lock() {
                        *last = Instant::now();
                    }
                    if !alive.swap(true, Ordering::SeqCst) {
                        debug_log(&log_h, "page heartbeat received");
                    }
                });
            }

            {
                let alive = page_alive.clone();
                let log_h = handle.clone();
                std::thread::spawn(move || {

                    for i in 0..40 {
                        std::thread::sleep(Duration::from_secs(5));
                        if alive.load(Ordering::SeqCst) {
                            debug_log(&log_h, "smoke-ok: page alive");
                            break;
                        }
                        if i == 39 {
                            debug_log(&log_h, "smoke-fail: no heartbeat in 200s");
                        }
                    }
                });
            }

            if o.debug {
                let h = handle.clone();
                handle.listen("debug", move |event| {
                    debug_log(&h, event.payload());
                });
            }

            let h = handle.clone();
            let hb = heartbeat.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(HEARTBEAT_POLL);
                let stale = hb.last.lock().map(|l| l.elapsed() > HEARTBEAT_TIMEOUT).unwrap_or(true);
                if stale {
                    debug_log(&h, "watchdog: heartbeat stale, reloading");
                    if let Some(win) = h.get_webview_window("main") {
                        let _ = win.reload();
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building PrivateWhatsapp")
        .run(|_app, _event| {});
}