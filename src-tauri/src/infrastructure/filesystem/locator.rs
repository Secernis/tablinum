use std::path::{Path, PathBuf};

use crate::application::ports::RepositoryLocator;
use crate::domain::repository::RepoPath;

/// Finds repositories by walking directories and looking for `.git`.
#[derive(Debug, Default, Clone, Copy)]
pub struct FsLocator;

/// Directory names never worth descending into.
///
/// Dependency trees and build output are the bulk of most project folders and
/// never contain a repository of the user's own; the OS folders are enormous
/// and equally barren. Dot-directories are skipped separately.
const SKIP: &[&str] = &[
    "node_modules", "target", "dist", "build", "out", "vendor", "venv", "__pycache__",
    "AppData", "Application Data", "Library", "Program Files", "Windows",
];

/// Upper bound on directories visited per scan.
///
/// A depth limit alone does not bound the work — a wide tree at depth three
/// can hold a hundred thousand folders. Past this the scan stops and reports
/// what it has, which is a shorter list rather than a hung window.
const VISIT_BUDGET: usize = 30_000;

fn is_repository(dir: &Path) -> bool {
    // `.git` is a directory in a normal checkout and a file in a worktree or
    // submodule; both mean "a repository lives here".
    dir.join(".git").exists()
}

fn skip_name(name: &str) -> bool {
    name.starts_with('.') || SKIP.iter().any(|s| s.eq_ignore_ascii_case(name))
}

fn walk(dir: &Path, depth: usize, max_depth: usize, budget: &mut usize, out: &mut Vec<RepoPath>) {
    if *budget == 0 {
        return;
    }
    *budget -= 1;
    if is_repository(dir) {
        out.push(RepoPath::from_existing_dir(dir.to_path_buf()));
        // A repository inside a repository is a submodule or a vendored
        // checkout, and the picker lists projects, not their parts.
        return;
    }
    if depth >= max_depth {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        // Unreadable is unremarkable during a scan; it is logged for the case
        // where a repository is missing from the list and someone asks why.
        log::debug!("locate.read_dir.skipped path={}", dir.display());
        return;
    };
    for entry in entries.flatten() {
        // A symlinked directory can point back up the tree; not following any
        // is cheaper than detecting the loop.
        let Ok(kind) = entry.file_type() else { continue };
        if !kind.is_dir() {
            continue;
        }
        let name = entry.file_name();
        if skip_name(&name.to_string_lossy()) {
            continue;
        }
        walk(&entry.path(), depth + 1, max_depth, budget, out);
    }
}

impl RepositoryLocator for FsLocator {
    fn locate(&self, roots: &[PathBuf], max_depth: usize) -> Vec<RepoPath> {
        let mut out = Vec::new();
        let mut budget = VISIT_BUDGET;
        for root in roots.iter().filter(|r| r.is_dir()) {
            walk(root, 0, max_depth, &mut budget, &mut out);
        }
        out.sort();
        out.dedup();
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_and_listed_names_are_skipped() {
        assert!(skip_name(".cache"));
        assert!(skip_name("node_modules"));
        assert!(skip_name("NODE_MODULES"));
        assert!(!skip_name("tablinum"));
    }

    #[test]
    fn finds_a_repository_and_does_not_descend_into_it() {
        let base = std::env::temp_dir().join(format!("tablinum-locate-{}", std::process::id()));
        let repo = base.join("proj");
        let nested = repo.join("vendor-copy");
        std::fs::create_dir_all(nested.join(".git")).unwrap();
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        std::fs::create_dir_all(base.join("node_modules").join("dep").join(".git")).unwrap();

        let found = FsLocator.locate(std::slice::from_ref(&base), 4);
        let names: Vec<String> = found.iter().map(|p| p.name()).collect();
        assert_eq!(names, vec!["proj"]);

        std::fs::remove_dir_all(&base).unwrap();
    }
}
