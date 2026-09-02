use std::path::PathBuf;

use crate::domain::repository::LocatedRepository;

use super::ports::{HistorySource, RepositoryLocator};

/// What to scan.
#[derive(Debug, Clone)]
pub struct DiscoverRequest {
    /// Directories to search; empty means the locator's defaults.
    pub roots: Vec<PathBuf>,
    /// How deep below each root to look.
    pub max_depth: usize,
}

/// Directories described at once per scan.
///
/// Describing a repository costs a git process, and a desktop with fifty
/// repositories would otherwise wait for fifty of them in a row. Eight keeps
/// the machine responsive while the picker fills.
const DESCRIBE_PARALLELISM: usize = 8;

/// Find the repositories under the requested roots, ready to be listed.
///
/// A directory the locator found but the history source refuses (a stray
/// `.git` folder, a permission problem) is dropped from the list, not turned
/// into an error: one broken folder must not empty the whole picker. It is
/// logged, so the omission can be traced when someone misses a repository.
pub fn discover_repositories(
    locator: &dyn RepositoryLocator,
    source: &dyn HistorySource,
    request: DiscoverRequest,
) -> Vec<LocatedRepository> {
    let roots = if request.roots.is_empty() {
        locator.default_roots()
    } else {
        request.roots
    };
    let paths = locator.locate(&roots, request.max_depth);

    let mut found = Vec::with_capacity(paths.len());
    for chunk in paths.chunks(DESCRIBE_PARALLELISM) {
        let described: Vec<Option<LocatedRepository>> = std::thread::scope(|scope| {
            let handles: Vec<_> = chunk
                .iter()
                .map(|path| {
                    scope.spawn(move || match source.describe(path) {
                        Ok(repository) => match source.head(&repository) {
                            Ok(head) => Some(LocatedRepository { repository, head }),
                            Err(e) => {
                                log::warn!("discover.head.failed path={path} error={e}");
                                None
                            }
                        },
                        Err(e) => {
                            log::warn!("discover.describe.failed path={path} error={e}");
                            None
                        }
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().unwrap_or_default())
                .collect()
        });
        found.extend(described.into_iter().flatten());
    }

    LocatedRepository::sort_by_recency(&mut found);
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::AppError;
    use crate::domain::history::HistorySummary;
    use crate::domain::repository::{HeadInfo, RepoPath, Repository};

    struct FixedLocator(Vec<RepoPath>);
    impl RepositoryLocator for FixedLocator {
        fn default_roots(&self) -> Vec<PathBuf> {
            vec![PathBuf::from("/default")]
        }
        fn locate(&self, roots: &[PathBuf], _max_depth: usize) -> Vec<RepoPath> {
            assert_eq!(roots, [PathBuf::from("/default")]);
            self.0.clone()
        }
    }

    /// Answers for every path except one, which it refuses.
    struct RefusingSource {
        refuse: &'static str,
    }
    impl HistorySource for RefusingSource {
        fn describe(&self, path: &RepoPath) -> Result<Repository, AppError> {
            if path.name() == self.refuse {
                return Err(AppError::NotARepository { path: path.to_string() });
            }
            Ok(Repository::new(path.clone(), Some("main".into())))
        }
        fn head(&self, repository: &Repository) -> Result<Option<HeadInfo>, AppError> {
            let at = repository.name().len() as i64;
            Ok(Some(HeadInfo { subject: "s".into(), at }))
        }
        fn summarize(&self, _r: &Repository, _n: usize) -> Result<HistorySummary, AppError> {
            Ok(HistorySummary::empty())
        }
    }

    fn path(name: &str) -> RepoPath {
        RepoPath::from_existing_dir(PathBuf::from(format!("/r/{name}")))
    }

    #[test]
    fn refused_directories_are_dropped_and_the_rest_sorted() {
        let locator = FixedLocator(vec![path("aa"), path("stray"), path("bbbb")]);
        let source = RefusingSource { refuse: "stray" };
        let found = discover_repositories(
            &locator,
            &source,
            DiscoverRequest { roots: vec![], max_depth: 3 },
        );
        let names: Vec<String> = found.iter().map(|l| l.repository.name()).collect();
        assert_eq!(names, vec!["bbbb", "aa"]);
    }
}
