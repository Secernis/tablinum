// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    disable_webkit_dmabuf_renderer();
    tablinum_lib::run()
}

/// Keep WebKitGTK off its DMA-BUF renderer on Linux.
///
/// On NVIDIA under Wayland that renderer kills the window at start with
/// "Error 71 (Protocol error) dispatching to Wayland display". The fallback
/// costs some compositing speed on every Linux machine, which a Git client
/// can afford; a window that never opens it cannot. A value the user already
/// set wins, so the renderer can be switched back on to test a driver fix.
///
/// Called first in `main`: `set_var` is only sound while the process is still
/// single-threaded, and WebKit reads the variable when it initialises.
#[cfg(target_os = "linux")]
fn disable_webkit_dmabuf_renderer() {
    const VAR: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
    if std::env::var_os(VAR).is_none() {
        std::env::set_var(VAR, "1");
    }
}

#[cfg(not(target_os = "linux"))]
fn disable_webkit_dmabuf_renderer() {}
