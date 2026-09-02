//! The history source backed by the `git` command line.

mod history_source;
mod parse;
mod runner;

pub use history_source::GitCli;
