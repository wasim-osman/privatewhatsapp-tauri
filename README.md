# PrivateWhatsapp (Tauri)

Cross-platform skeleton of the macOS **PrivateWhatsapp** wrapper, ported to
[Tauri 2](https://tauri.app). System webview on every OS (WKWebView on macOS,
WebView2 on Windows, WebKitGTK on Linux) — same "no bundled Chromium" philosophy
as the macOS app.

The injected feature layer (`scripts/*.js`) is the same JavaScript used by the
macOS Swift app (cleanup, call hiding, retention, heartbeat, call banner) —
only the OS-facing wrapper is rewritten in Rust.

## Layout

```
src/main.rs          flags, menu, window, event bridge, watchdog/relaunch
scripts/bridge.js     __pw.emit() helper (Tauri events)
scripts/heartbeat.js  page liveness pulse every 15s
scripts/cleanup.js    promo UI, Meta AI, call buttons, call menu items
scripts/callstate.js  incoming-call banner (in-page, non-clickable)
scripts/retention.js  15-day IndexedDB pruning (batched, typing-safe)
scripts/debug.js      diagnostics dump (--debug only)
tauri.conf.json        window-less config + minimal remote capability
```

## Menu

A native menu bar is installed on the main window:

| Item      | Accelerator          |
|-----------|----------------------|
| Hide / Hide Others / Show All | `⌘H` / `⌥⌘H` |
| Quit | `⌘Q` |
| Undo / Redo | `⌘Z` / `⇧⌘Z` |
| Cut / Copy / Paste / Select All | `⌘X` / `⌘C` / `⌘V` / `⌘A` |
| Reload (custom handler) | `⌘R` |
| Fullscreen | platform default (`⌃⌘F` on macOS) |

Edit-menu items use Tauri's `PredefinedMenuItem` so their accelerators route to
the platform's responder chain (i.e. Copy/Paste reach the WhatsApp text field).
`Reload` is a custom item that issues `window.reload()` — the macOS `⌘R`
equivalent. Zoom is handled by the webview's built-in `zoom_hotkeys_enabled`;
the config also grants `core:webview:allow-set-webview-zoom`.

## Run (dev)

```sh
cargo install tauri-cli
cargo tauri dev
```

For a release build: `cargo tauri build`.

## Flags

| Flag            | Effect                                                          |
|-----------------|-----------------------------------------------------------------|
| `--ephemeral`   | Webview data in a temp dir — nothing persists after quit         |
| `--no-scripts`  | disable all injected feature scripts                             |
| `--no-retention`| keep scripts but skip the pruning job                            |
| `--debug`       | write a diagnostic log to the app log dir                        |

## Design notes

- The window loads `https://web.whatsapp.com` directly;
  `initialization_script` runs before `window.onload` on every navigation.
- Page -> Rust uses Tauri **events** (heartbeat, debug). No commands are
  exposed to the remote page; the capability grants only `core:event:allow-emit`
  so the security surface stays small.
- Watchdog: Rust thread reloads the window if no heartbeat arrives for 60s
  (mirrors the macOS dead-page recovery). Window, relaunch, side panel banner
  handled natively per-platform in later iterations.
- The incoming-call banner is DOM-based (works everywhere) instead of a native
  overlay.

## Platform gaps / TODO (per OS)

- macOS: Gatekeeper needs a signed DMG (ad-hoc works) and only network access
  is desired; review Tauri's generated entitlements.
- Windows: WebView2 is available on Win10/11; sandboxing the process is best
  done with an AppContainer or WDAC policy.
- Linux: needs `webkit2gtk-4.1` dev packages; distribute as Flatpak with only
  `--socket=network` for a sandbox.
- Icons: add `src-tauri/icons/` (run `tauri icon app-source.png`).