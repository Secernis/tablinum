use std::path::PathBuf;

use crate::domain::repository::LocatedRepository;

use super::ports::{CodeSizeSource, HistorySource, RepositoryLocator};

/// What to scan.
#[derive(Debug, Clone)]
pub struct DiscoverRequest {
    /// Directories to search, as the user chose them.
    pub roots: Vec<PathBuf>,
    /// How deep below each root to look.
    pub max_depth: usize,
}

/// Directories described at once per scan.
///
/// Describing a repository costs git processes and a line count, and a folder
/// with fifty repositories would otherwise wait for fifty of them in a row.
/// Eight keeps the machine responsive while the list fills.
const DESCRIBE_PARALLELISM: usize = 8;

/// Find the repositories under the requested roots, handing each one to
/// `found` as soon as it is described.
///
/// Streaming rather than returning a list, because the interface should fill
/// while the scan runs — a list that appears all at once after a pause reads
/// as the app hanging, and the order of arrival is the interface's to sort.
///
/// A directory the locator found but the history source refuses (a stray
/// `.git` folder, a permission problem) is skipped, not turned into an error:
/// one broken folder must not empty the whole list. A code measurement that
/// fails degrades to a row without a size. Both are logged, so the omission
/// can be traced when someone misses something.
///
/// Returns how many repositories were handed over.
pub fn discover_repositories(
    locator: &dyn RepositoryLocator,
    source: &dyn HistorySource,
    code: &dyn CodeSizeSource,
    request: DiscoverRequest,
    found: &(dyn Fn(LocatedRepository) + Sync),
) -> usize {
    let paths = locator.locate(&request.roots, request.max_depth);
    let mut count = 0;
    for chunk in paths.chunks(DESCRIBE_PARALLELISM) {
        let described: Vec<bool> = std::thread::scope(|scope| {
            let handles: Vec<_> = chunk
                .iter()
                .map(|path| {
                    scope.spawn(move || {
                        let repository = match source.describe(path) {
                            Ok(r) => r,
                            Err(e) => {
                                log::warn!("discover.describe.failed path={path} error={e}");
                                return false;
                            }
                        };
                        let head = match source.head(&repository) {
                            Ok(head) => head,
                            Err(e) => {
                                log::warn!("discover.head.failed path={path} error={e}");
                                return false;
                            }
                        };
                        let commit_count = match source.commit_count(&repository) {
                            Ok(n) => n,
                            Err(e) => {
                                log::warn!("discover.count.failed path={path} error={e}");
                                0
                            }
                        };
                        let size = match code.measure(&repository) {
                            Ok(size) => Some(size),
                            Err(e) => {
                                log::warn!("discover.measure.failed path={path} error={e}");
                                None
                            }
                        };
                        found(LocatedRepository {
                            repository,
                            head,
                            commit_count,
                            code: size,
                        });
                        true
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap_or(false)).collect()
        });
        count += described.into_iter().filter(|ok| *ok).count();
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::AppError;
    use crate::domain::analysis::CodeSize;
    use crate::domain::history::{Commit, HistorySummary};
    use crate::domain::repository::{HeadInfo, RepoPath, Repository};
    use std::sync::Mutex;

    struct FixedLocator(Vec<RepoPath>);
    impl RepositoryLocator for FixedLocator {
        fn locate(&self, roots: &[PathBuf], _max_depth: usize) -> Vec<RepoPath> {
            assert_eq!(roots, [PathBuf::from("/chosen")]);
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
        fn commit_count(&self, _r: &Repository) -> Result<u64, AppError> {
            Ok(7)
        }
        fn summarize(&self, _r: &Repository, _n: usize) -> Result<HistorySummary, AppError> {
            Ok(HistorySummary::empty())
        }
        fn commits(&self, _r: &Repository, _skip: usize, _limit: usize) -> Result<Vec<Commit>, AppError> {
            Ok(Vec::new())
        }
    }

    /// Refuses to measure anything: a row must still arrive.
    struct NoCode;
    impl CodeSizeSource for NoCode {
        fn measure(&self, _r: &Repository) -> Result<CodeSize, AppError> {
            Err(AppError::Failed { message: "no counter".into() })
        }
    }

    fn path(name: &str) -> RepoPath {
        RepoPath::from_existing_dir(PathBuf::from(format!("/r/{name}")))
    }

    #[test]
    fn refused_directories_are_skipped_and_the_rest_streamed() {
        let locator = FixedLocator(vec![path("aa"), path("stray"), path("bbbb")]);
        let source = RefusingSource { refuse: "stray" };
        let seen = Mutex::new(Vec::new());
        let count = discover_repositories(
            &locator,
            &source,
            &NoCode,
            DiscoverRequest { roots: vec![PathBuf::from("/chosen")], max_depth: 3 },
            &|l| seen.lock().unwrap().push((l.repository.name(), l.commit_count, l.code.is_none())),
        );
        let mut rows = seen.into_inner().unwrap();
        rows.sort();
        assert_eq!(count, 2);
        assert_eq!(rows, vec![("aa".to_string(), 7, true), ("bbbb".to_string(), 7, true)]);
    }
}
