//! Composition root.
//!
//! The layers and the one place that wires them: plugins, and the commands
//! the frontend may invoke. Nothing else lives here on purpose — a file that
//! owns the builder is the file everything would otherwise drift into.

mod application;
mod domain;
mod infrastructure;
mod interface;

/// Start the desktop app.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            interface::commands::default_roots,
            interface::commands::discover_repositories,
            interface::commands::open_repository,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
