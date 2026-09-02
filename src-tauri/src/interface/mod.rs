//! The Tauri surface: commands, the DTOs they speak, the error they return.
//!
//! The only layer that knows serde or `#[tauri::command]`. Domain types never
//! cross the IPC boundary directly — a DTO is the contract with the frontend
//! and may stay stable while the domain behind it moves.

pub mod commands;
pub mod dto;
