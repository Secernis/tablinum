use std::path::PathBuf;

use crate::application::ports::HistorySource;
use crate::application::AppError;
use crate::domain::history::HistorySummary;
use crate::domain::repository::{HeadInfo, RepoPath, Repository};

use super::parse;
use super::runner::{self, GitError};

/// The history source that shells out to `git`.
///
/// Stateless: every call is one or more git processes in the repository's
/// directory. Fine for a picker and an overview; a view that asks per
/// keystroke would want a cache in front of it, and that cache belongs in a
/// second adapter, not in here.
#[derive(Debug, Default, Clone, Copy)]
pub struct GitCli;

impl GitCli {
    /// Whether an error means "there is no commit yet" rather than a failure.
    ///
    /// git has no dedicated exit code for an unborn HEAD; it reports it as an
    /// unknown revision. These are the phrasings across the versions in use.
    fn is_unborn(err: &GitError) -> bool {
        match err {
            GitError::Failed { message } => {
                message.contains("does not have any commits")
                    || message.contains("unknown revision")
                    || message.contains("bad revision")
                    || message.contains("ambiguous argument 'HEAD'")
            }
            _ => false,
        }
    }
}

fn to_app_error(err: GitError) -> AppError {
    match err {
        GitError::NotInstalled => AppError::GitNotInstalled,
        GitError::NotARepository { path } => AppError::NotARepository { path },
        GitError::Failed { message } => AppError::Failed { message },
    }
}

/// git prints the top level with forward slashes even on Windows; the user
/// recognises their own path in the native form.
fn native_path(s: &str) -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(s.replace('/', "\\"))
    } else {
        PathBuf::from(s)
    }
}

impl HistorySource for GitCli {
    fn describe(&self, path: &RepoPath) -> Result<Repository, AppError> {
        let top = runner::run(path.as_path(), &["rev-parse", "--show-toplevel"]).map_err(to_app_error)?;
        // The user may have picked a subdirectory; the repository is its root.
        let root = RepoPath::new(native_path(&top))?;
        // `-q` makes a detached HEAD exit 1 with nothing on stderr, which is
        // the one failure that is an answer rather than an error.
        let branch = match runner::run(root.as_path(), &["symbolic-ref", "--short", "-q", "HEAD"]) {
            Ok(name) if !name.is_empty() => Some(name),
            Ok(_) => None,
            Err(GitError::Failed { message }) if message.is_empty() => None,
            Err(e) => return Err(to_app_error(e)),
        };
        Ok(Repository::new(root, branch))
    }

    fn head(&self, repository: &Repository) -> Result<Option<HeadInfo>, AppError> {
        let format = format!("--format=%ct{}%s", parse::FIELD);
        match runner::run(repository.path().as_path(), &["log", "-1", &format, "HEAD"]) {
            Ok(out) => Ok(parse::parse_head(&out)),
            Err(e) if Self::is_unborn(&e) => Ok(None),
            Err(e) => Err(to_app_error(e)),
        }
    }

    fn commit_count(&self, repository: &Repository) -> Result<u64, AppError> {
        match runner::run(repository.path().as_path(), &["rev-list", "--count", "HEAD"]) {
            Ok(out) => Ok(out.trim().parse().unwrap_or(0)),
            Err(e) if Self::is_unborn(&e) => Ok(0),
            Err(e) => Err(to_app_error(e)),
        }
    }

    fn summarize(&self, repository: &Repository, recent_limit: usize) -> Result<HistorySummary, AppError> {
        let Some(head) = self.head(repository)? else {
            return Ok(HistorySummary::empty());
        };
        let cwd = repository.path().as_path();
        let git = |args: &[&str]| runner::run(cwd, args).map_err(to_app_error);

        let commit_count = self.commit_count(repository)?;
        let author_count = parse::count_distinct_lines(&git(&["log", "--format=%aE", "HEAD"])?);
        let first_commit_at = parse::parse_oldest_timestamp(&git(&["log", "--max-parents=0", "--format=%ct", "HEAD"])?);

        let limit = recent_limit.to_string();
        let f = parse::FIELD;
        let format = format!("--format={}%h{f}%s{f}%an{f}%ae{f}%ct", parse::RECORD);
        let recent = parse::parse_recent(&git(&["log", "-n", &limit, &format, "--shortstat", "HEAD"])?);

        Ok(HistorySummary {
            commit_count,
            author_count,
            first_commit_at,
            last_commit_at: Some(head.at),
            recent,
        })
    }
}
