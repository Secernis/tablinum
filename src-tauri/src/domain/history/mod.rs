//! The history context: commits, their authors, and what a history adds up to.

mod commit;
mod summary;

pub use commit::{Author, AuthorActivity, Commit, CommitStats};
pub use summary::HistorySummary;
