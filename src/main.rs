#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use std::io::Write;

use tauri::menu::{Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Listener, Manager, WebviewUrl, WebviewWindowBuilder};

const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15";
const HOME_URL: &str = "https://web.whatsapp.com";

const MAX_LOG_BYTES: u64 = 1024 * 1024;
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
        bundle.push_str(include_str!("../scripts/session.js"));
        if !opts.no_retention {
            bundle.push_str(include_str!("../scripts/retention.js"));
        }
    }
    if opts.debug {
        bundle.push_str(include_str!("../scripts/debug.js"));
    }
    bundle
}

fn today_stamp() -> String {
    // civil date from days since the epoch (UTC)
    let days = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| (d.as_secs() / 86400) as i64)
        .unwrap_or(0);
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

fn now_stamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{:02}:{:02}:{:02}Z", (secs / 3600) % 24, (secs / 60) % 60, secs % 60)
}

/// Portable mode: if a `portable.txt` file sits next to the executable, keep all
/// webview data in `PrivateWhatsapp-data` beside it instead of the user profile.
fn portable_data_dir() -> Option<std::path::PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    if exe_dir.join("portable.txt").is_file() {
        Some(exe_dir.join("PrivateWhatsapp-data"))
    } else {
        None
    }
}

fn ephemeral_dir() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("pw-ephemeral-{}", std::process::id()))
}

/// Persistent log location (macOS: ~/Library/Logs/io.private.whatsapp). The temp
/// dir is only a fallback: macOS purges it, which loses the history we need to
/// diagnose logouts.
fn log_dir(app: &AppHandle) -> std::path::PathBuf {
    app.path().app_log_dir().unwrap_or_else(|_| std::env::temp_dir())
}

fn log_file(app: &AppHandle) -> std::path::PathBuf {
    if let Ok(p) = std::env::var("PW_LOG_PATH") {
        return std::path::PathBuf::from(p);
    }
    log_dir(app).join("privatewhatsapp.log")
}

fn debug_log(app: &AppHandle, text: &str) {
    let file = log_file(app);
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    // keep the log bounded: start over once it passes 1 MiB
    if std::fs::metadata(&file).map(|m| m.len() > MAX_LOG_BYTES).unwrap_or(false) {
        let _ = std::fs::remove_file(&file);
    }
    let text: String = text.chars().take(4096).collect();
    let line = format!("[{} {}] {}\n", today_stamp(), now_stamp(), text);
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
        .about(None)
        .separator()
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

    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    Menu::with_items(app, &[&app_menu, &edit, &view, &window])
}

fn main() {
    let opts = parse_options();
    let ephemeral = opts.ephemeral;

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
                let dir = ephemeral_dir();
                let _ = std::fs::create_dir_all(&dir);
                builder = builder.data_directory(dir);
            } else if let Some(dir) = portable_data_dir() {
                let _ = std::fs::create_dir_all(&dir);
                builder = builder.data_directory(dir);
            }

            let _window = builder.build().unwrap_or_else(|e| {
                debug_log(&handle, &format!("FAIL window build: {e}"));
                std::process::exit(1);
            });
            debug_log(&handle, "window built ok");

            // Unclean-exit detection: the marker is removed on a normal exit, so
            // finding it at startup means the last run was killed/crashed (or is
            // still running, i.e. two instances sharing one data store).
            let marker = log_dir(&handle).join("running.pid");
            if let Ok(prev) = std::fs::read_to_string(&marker) {
                debug_log(
                    &handle,
                    &format!("startup: previous run (pid {}) did not exit cleanly, or is still running", prev.trim()),
                );
            }
            let _ = std::fs::create_dir_all(log_dir(&handle));
            let _ = std::fs::write(&marker, std::process::id().to_string());
            debug_log(
                &handle,
                &format!(
                    "startup: v{} pid {} ephemeral={} portable={}",
                    env!("CARGO_PKG_VERSION"),
                    std::process::id(),
                    o.ephemeral,
                    portable_data_dir().is_some()
                ),
            );

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

            {
                // always-on, small: login-state transitions from session.js
                let h = handle.clone();
                handle.listen("session", move |event| {
                    debug_log(&h, &format!("session {}", event.payload()));
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
                    // restart the clock so a slow load isn't reloaded again every poll
                    if let Ok(mut last) = hb.last.lock() {
                        *last = Instant::now();
                    }
                    if let Some(win) = h.get_webview_window("main") {
                        let _ = win.reload();
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building PrivateWhatsapp")
        .run(move |app, event| match event {
            tauri::RunEvent::ExitRequested { .. } => debug_log(app, "exit requested"),
            tauri::RunEvent::Exit => {
                let _ = std::fs::remove_file(log_dir(app).join("running.pid"));
                debug_log(app, "exit clean");
                if ephemeral {
                    let _ = std::fs::remove_dir_all(ephemeral_dir());
                }
            }
            _ => {}
        });
}