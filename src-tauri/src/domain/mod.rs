//! The domain: what Tablinum reasons about, with no I/O and no framework.
//!
//! Nothing in here knows about git as a program, Tauri, serde or the file
//! system. That is the point of the layer — a type here can be constructed in
//! a unit test with no repository on disk.

pub mod analysis;
pub mod history;
pub mod repository;
