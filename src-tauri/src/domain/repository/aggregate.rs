use super::RepoPath;

/// A repository the app has confirmed to be one.
///
/// `branch` is `None` for a detached HEAD — a real state, not an error, and
/// one the interface has to render rather than hide.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Repository {
    path: RepoPath,
    branch: Option<String>,
}

impl Repository {
    /// Build a repository from its confirmed path and current branch.
    pub fn new(path: RepoPath, branch: Option<String>) -> Self {
        Repository { path, branch }
    }

    /// Where the work tree lives.
    pub fn path(&self) -> &RepoPath {
        &self.path
    }

    /// What the user calls it: the directory name.
    pub fn name(&self) -> String {
        self.path.name()
    }

    /// The checked-out branch, or `None` when HEAD is detached.
    pub fn branch(&self) -> Option<&str> {
        self.branch.as_deref()
    }
}
