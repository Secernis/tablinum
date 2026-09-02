use serde::Serialize;

use crate::application::{AppError, OpenedRepository};
use crate::domain::history::{Commit, HistorySummary};
use crate::domain::repository::LocatedRepository;

/// A repository in the picker's list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocatedRepositoryDto {
    pub path: String,
    pub name: String,
    pub branch: Option<String>,
    pub head_subject: Option<String>,
    pub head_at: Option<i64>,
}

impl From<LocatedRepository> for LocatedRepositoryDto {
    fn from(l: LocatedRepository) -> Self {
        let (head_subject, head_at) = match l.head {
            Some(h) => (Some(h.subject), Some(h.at)),
            None => (None, None),
        };
        LocatedRepositoryDto {
            path: l.repository.path().to_string(),
            name: l.repository.name(),
            branch: l.repository.branch().map(str::to_string),
            head_subject,
            head_at,
        }
    }
}

/// One row of the recent-commits table.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDto {
    pub short_hash: String,
    pub subject: String,
    pub author_name: String,
    pub author_email: String,
    pub at: i64,
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
}

impl From<Commit> for CommitDto {
    fn from(c: Commit) -> Self {
        CommitDto {
            short_hash: c.short_hash,
            subject: c.subject,
            author_name: c.author.name,
            author_email: c.author.email,
            at: c.at,
            files_changed: c.stats.files_changed,
            insertions: c.stats.insertions,
            deletions: c.stats.deletions,
        }
    }
}

/// The overview numbers.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySummaryDto {
    pub commit_count: u64,
    pub author_count: u64,
    pub first_commit_at: Option<i64>,
    pub last_commit_at: Option<i64>,
    pub recent: Vec<CommitDto>,
}

impl From<HistorySummary> for HistorySummaryDto {
    fn from(h: HistorySummary) -> Self {
        HistorySummaryDto {
            commit_count: h.commit_count,
            author_count: h.author_count,
            first_commit_at: h.first_commit_at,
            last_commit_at: h.last_commit_at,
            recent: h.recent.into_iter().map(CommitDto::from).collect(),
        }
    }
}

/// An opened repository with its summary.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedRepositoryDto {
    pub path: String,
    pub name: String,
    pub branch: Option<String>,
    pub history: HistorySummaryDto,
}

impl From<OpenedRepository> for OpenedRepositoryDto {
    fn from(o: OpenedRepository) -> Self {
        OpenedRepositoryDto {
            path: o.repository.path().to_string(),
            name: o.repository.name(),
            branch: o.repository.branch().map(str::to_string),
            history: o.history.into(),
        }
    }
}

/// The error a command returns, tagged so the frontend switches on `kind`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ErrorDto {
    GitNotInstalled,
    NotARepository { path: String },
    InvalidPath { reason: String },
    Failed { message: String },
}

impl From<AppError> for ErrorDto {
    fn from(e: AppError) -> Self {
        match e {
            AppError::GitNotInstalled => ErrorDto::GitNotInstalled,
            AppError::NotARepository { path } => ErrorDto::NotARepository { path },
            AppError::InvalidPath { reason } => ErrorDto::InvalidPath { reason },
            AppError::Failed { message } => ErrorDto::Failed { message },
        }
    }
}
