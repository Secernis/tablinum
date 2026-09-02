use serde::Serialize;

use crate::application::{AppError, OpenedRepository};
use crate::domain::analysis::CodeSize;
use crate::domain::history::{AuthorActivity, Commit, HistorySummary};
use crate::domain::repository::LocatedRepository;

/// One language's share of the code.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageShareDto {
    pub name: String,
    pub code: u64,
}

/// The size of the code, when it could be measured.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSizeDto {
    pub files: u64,
    pub code: u64,
    pub comments: u64,
    pub blanks: u64,
    pub languages: Vec<LanguageShareDto>,
}

impl From<CodeSize> for CodeSizeDto {
    fn from(c: CodeSize) -> Self {
        CodeSizeDto {
            files: c.files,
            code: c.code,
            comments: c.comments,
            blanks: c.blanks,
            languages: c
                .languages
                .into_iter()
                .map(|l| LanguageShareDto { name: l.name, code: l.code })
                .collect(),
        }
    }
}

/// A repository in the picker's list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocatedRepositoryDto {
    pub path: String,
    pub name: String,
    pub branch: Option<String>,
    pub head_subject: Option<String>,
    pub head_at: Option<i64>,
    pub commit_count: u64,
    pub code: Option<CodeSizeDto>,
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
            commit_count: l.commit_count,
            code: l.code.map(CodeSizeDto::from),
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

/// One author's share of the commits.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorActivityDto {
    pub name: String,
    pub email: String,
    pub commits: u64,
}

impl From<AuthorActivity> for AuthorActivityDto {
    fn from(a: AuthorActivity) -> Self {
        AuthorActivityDto {
            name: a.author.name,
            email: a.author.email,
            commits: a.commits,
        }
    }
}

/// The overview numbers.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySummaryDto {
    pub commit_count: u64,
    pub author_count: u64,
    pub authors: Vec<AuthorActivityDto>,
    pub first_commit_at: Option<i64>,
    pub last_commit_at: Option<i64>,
    pub recent: Vec<CommitDto>,
}

impl From<HistorySummary> for HistorySummaryDto {
    fn from(h: HistorySummary) -> Self {
        HistorySummaryDto {
            commit_count: h.commit_count,
            author_count: h.author_count(),
            authors: h.authors.into_iter().map(AuthorActivityDto::from).collect(),
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
    pub code: Option<CodeSizeDto>,
}

impl From<OpenedRepository> for OpenedRepositoryDto {
    fn from(o: OpenedRepository) -> Self {
        OpenedRepositoryDto {
            path: o.repository.path().to_string(),
            name: o.repository.name(),
            branch: o.repository.branch().map(str::to_string),
            history: o.history.into(),
            code: o.code.map(CodeSizeDto::from),
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
