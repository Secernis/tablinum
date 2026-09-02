//! Adapters: the ports, implemented against real tools.
//!
//! This is the only layer that spawns processes or reads directories. Each
//! adapter is one file per port so that swapping one — a libgit2 source next
//! to the CLI one, say — is a new file, not a rewrite.

pub mod filesystem;
pub mod git_cli;
