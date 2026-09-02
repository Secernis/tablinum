use std::fmt;

use crate::domain::repository::RepoPathError;

/// Why a use case could not deliver.
///
/// Three shapes because the interface reacts to them differently: a missing
/// git is explained once and the app is otherwise idle; a wrong folder is a
/// picker mistake to recover from in place; anything else is shown with git's
/// own words, because paraphrasing them loses the one detail that helps.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppError {
    /// `git` is not available on this machine.
    GitNotInstalled,
    /// The directory is not a git work tree.
    NotARepository { path: String },
    /// The directory could not be used at all.
    InvalidPath { reason: String },
    /// git ran and refused; `message` is what it said.
    Failed { message: String },
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::GitNotInstalled => write!(f, "git is not installed"),
            AppError::NotARepository { path } => write!(f, "{path} is not a git repository"),
            AppError::InvalidPath { reason } => write!(f, "{reason}"),
            AppError::Failed { message } => write!(f, "git failed: {message}"),
        }
    }
}

impl From<RepoPathError> for AppError {
    fn from(e: RepoPathError) -> Self {
        AppError::InvalidPath {
            reason: e.to_string(),
        }
    }
}
