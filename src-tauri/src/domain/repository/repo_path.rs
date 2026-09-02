use std::fmt;
use std::path::{Path, PathBuf};

/// Why a path cannot become a [`RepoPath`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RepoPathError {
    /// The path does not exist on disk.
    Missing(PathBuf),
    /// The path exists but is a file, not a directory.
    NotADirectory(PathBuf),
}

impl fmt::Display for RepoPathError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RepoPathError::Missing(p) => write!(f, "{} does not exist", p.display()),
            RepoPathError::NotADirectory(p) => write!(f, "{} is not a directory", p.display()),
        }
    }
}

/// A directory that may hold a repository.
///
/// A value object rather than a bare `PathBuf` because the invariant matters
/// downstream: every consumer may assume the directory exists, so the check
/// happens once, at the boundary where the string came in. Whether it is
/// actually a repository is git's call, not the file system's — that is
/// answered by the history source.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct RepoPath(PathBuf);

impl RepoPath {
    /// Validate that `path` is an existing directory.
    pub fn new(path: impl Into<PathBuf>) -> Result<Self, RepoPathError> {
        let path = path.into();
        if !path.exists() {
            return Err(RepoPathError::Missing(path));
        }
        if !path.is_dir() {
            return Err(RepoPathError::NotADirectory(path));
        }
        Ok(RepoPath(path))
    }

    /// Wrap a directory that is already known to exist.
    ///
    /// For callers that just listed the directory — re-checking would be a
    /// second `stat` per candidate during discovery for no new information.
    pub fn from_existing_dir(path: PathBuf) -> Self {
        RepoPath(path)
    }

    /// The underlying path.
    pub fn as_path(&self) -> &Path {
        &self.0
    }

    /// The directory's own name, which is what a user calls the repository.
    ///
    /// A root such as `C:\` has no file name; the full path is the honest
    /// fallback.
    pub fn name(&self) -> String {
        self.0
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| self.0.display().to_string())
    }
}

impl fmt::Display for RepoPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0.display())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_is_the_last_component() {
        let p = RepoPath::from_existing_dir(PathBuf::from("/home/someone/projects/tablinum"));
        assert_eq!(p.name(), "tablinum");
    }

    #[test]
    fn a_missing_path_is_refused() {
        let err = RepoPath::new("/definitely/not/here/tablinum").unwrap_err();
        assert!(matches!(err, RepoPathError::Missing(_)));
    }
}
