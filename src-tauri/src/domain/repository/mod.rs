//! The repository context: locating a repository and naming it.

mod aggregate;
mod located;
mod repo_path;

pub use aggregate::Repository;
pub use located::{HeadInfo, LocatedRepository};
pub use repo_path::{RepoPath, RepoPathError};
