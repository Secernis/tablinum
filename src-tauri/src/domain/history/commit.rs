/// Who wrote a commit.
///
/// Name and email together, because neither alone identifies a person across a
/// history: names get reformatted, emails change with employers.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Author {
    pub name: String,
    pub email: String,
}

/// The size of a commit, as git's shortstat counts it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CommitStats {
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
}

/// One commit, as much of it as the overview shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Commit {
    /// Abbreviated hash — enough to name it to a person, not to address it.
    pub short_hash: String,
    pub subject: String,
    pub author: Author,
    /// Committer timestamp, seconds since the epoch.
    pub at: i64,
    pub stats: CommitStats,
}
