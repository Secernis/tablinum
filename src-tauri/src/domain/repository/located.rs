use super::Repository;

/// The tip of a repository, as much as a list entry needs to say.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeadInfo {
    /// Subject line of the newest commit.
    pub subject: String,
    /// Committer timestamp of the newest commit, seconds since the epoch.
    pub at: i64,
}

/// A repository found by a scan, with enough to choose it from a list.
///
/// Distinct from [`Repository`] because it carries the head — the one fact a
/// user picks by ("which one did I touch last week?") — and because a list of
/// forty of these has to be cheap. Everything else about the history is read
/// only once one of them is opened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocatedRepository {
    pub repository: Repository,
    /// `None` for a repository with no commits yet.
    pub head: Option<HeadInfo>,
}

impl LocatedRepository {
    /// Order for the picker: most recently committed first, unborn last.
    ///
    /// Ties and unborn repositories fall back to the name so the order is
    /// stable between two scans — a list that reshuffles on every refresh is
    /// one the eye cannot search.
    pub fn sort_by_recency(list: &mut [LocatedRepository]) {
        list.sort_by(|a, b| {
            let at_a = a.head.as_ref().map(|h| h.at);
            let at_b = b.head.as_ref().map(|h| h.at);
            at_b.cmp(&at_a)
                .then_with(|| a.repository.name().to_lowercase().cmp(&b.repository.name().to_lowercase()))
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::repository::RepoPath;
    use std::path::PathBuf;

    fn located(name: &str, at: Option<i64>) -> LocatedRepository {
        LocatedRepository {
            repository: Repository::new(
                RepoPath::from_existing_dir(PathBuf::from(format!("/r/{name}"))),
                Some("main".into()),
            ),
            head: at.map(|at| HeadInfo { subject: "x".into(), at }),
        }
    }

    #[test]
    fn newest_first_and_unborn_last() {
        let mut list = vec![located("b", None), located("a", Some(10)), located("c", Some(20))];
        LocatedRepository::sort_by_recency(&mut list);
        let names: Vec<String> = list.iter().map(|l| l.repository.name()).collect();
        assert_eq!(names, vec!["c", "a", "b"]);
    }

    #[test]
    fn ties_break_on_name() {
        let mut list = vec![located("Zeta", Some(5)), located("alpha", Some(5))];
        LocatedRepository::sort_by_recency(&mut list);
        assert_eq!(list[0].repository.name(), "alpha");
    }
}
