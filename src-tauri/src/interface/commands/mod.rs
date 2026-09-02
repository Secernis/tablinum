//! Tauri commands, one file per context.

mod repositories;

// A glob on purpose: `#[tauri::command]` generates a companion macro per
// command that `generate_handler!` resolves by path, and only a glob carries
// it along with the function.
pub use repositories::*;
