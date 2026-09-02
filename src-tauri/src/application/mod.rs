//! Use cases: what the app does, expressed against ports rather than tools.
//!
//! A use case here takes its collaborators as trait objects and never names
//! git, the file system or Tauri. That is what lets the same code run against
//! the real adapters in the app and against hand-built ones in a test.

mod discover_repositories;
mod error;
mod list_commits;
mod open_repository;
pub mod ports;

pub use discover_repositories::{discover_repositories, DiscoverRequest};
pub use error::AppError;
pub use list_commits::list_commits;
pub use open_repository::{open_repository, OpenedRepository};
