//! Parsers for the exact git output shapes the source asks for.
//!
//! Every format string that produces input for this file lives next to its
//! parser's caller in `history_source.rs`; the two are one decision. Field
//! separators are control characters (`\x1f` between fields, `\x1e` between
//! records) because a subject line may contain any printable character,
//! including tabs and pipes.

use crate::domain::history::{Author, AuthorActivity, Commit, CommitStats};
use crate::domain::repository::HeadInfo;

/// Separates fields within one record.
pub const FIELD: char = '\x1f';
/// Separates records.
pub const RECORD: char = '\x1e';

/// `%ct<FIELD>%s` — one line.
pub fn parse_head(out: &str) -> Option<HeadInfo> {
    let line = out.lines().next()?;
    let (at, subject) = line.split_once(FIELD)?;
    Some(HeadInfo {
        subject: subject.to_string(),
        at: at.trim().parse().ok()?,
    })
}

/// `%h<FIELD>%s<FIELD>%an<FIELD>%ae<FIELD>%ct` per record, each optionally
/// followed by a `--shortstat` line. Records are prefixed with `RECORD`.
///
/// A record whose header does not parse is skipped rather than failing the
/// whole list: one odd commit must not blank the overview.
pub fn parse_recent(out: &str) -> Vec<Commit> {
    out.split(RECORD)
        .filter_map(|record| {
            let record = record.trim();
            if record.is_empty() {
                return None;
            }
            let mut lines = record.lines();
            let header = lines.next()?;
            let mut fields = header.split(FIELD);
            let short_hash = fields.next()?.to_string();
            let subject = fields.next()?.to_string();
            let name = fields.next()?.to_string();
            let email = fields.next()?.to_string();
            let at: i64 = fields.next()?.trim().parse().ok()?;
            let stats = lines
                .map(str::trim)
                .find(|l| l.contains("changed"))
                .map(parse_shortstat)
                .unwrap_or_default();
            Some(Commit {
                short_hash,
                subject,
                author: Author { name, email },
                at,
                stats,
            })
        })
        .collect()
}

/// ` 3 files changed, 10 insertions(+), 2 deletions(-)` in any subset.
///
/// Word-based rather than positional: git omits the parts that are zero, so
/// "2 files changed, 4 deletions(-)" is a real line.
pub fn parse_shortstat(line: &str) -> CommitStats {
    let mut stats = CommitStats::default();
    for part in line.split(',') {
        let mut words = part.split_whitespace();
        let (Some(number), Some(unit)) = (words.next(), words.next()) else {
            continue;
        };
        let Ok(n) = number.parse::<u32>() else {
            continue;
        };
        if unit.starts_with("file") {
            stats.files_changed = n;
        } else if unit.starts_with("insertion") {
            stats.insertions = n;
        } else if unit.starts_with("deletion") {
            stats.deletions = n;
        }
    }
    stats
}

/// One `%ct` per line; the oldest wins.
///
/// A history with several root commits (a merged-in unrelated history) has
/// several lines, and the first commit of the project is the oldest of them.
pub fn parse_oldest_timestamp(out: &str) -> Option<i64> {
    out.lines().filter_map(|l| l.trim().parse::<i64>().ok()).min()
}

/// `git shortlog -sne`: one `<count><TAB><name> <<email>>` per line, most first.
///
/// A line without the angle-bracket email (an old commit with none) keeps the
/// whole rest as the name and an empty email; it is still a person.
pub fn parse_shortlog(out: &str) -> Vec<AuthorActivity> {
    out.lines()
        .filter_map(|line| {
            let line = line.trim();
            let (count, rest) = line.split_once(char::is_whitespace)?;
            let commits: u64 = count.parse().ok()?;
            let rest = rest.trim();
            let (name, email) = match (rest.rfind('<'), rest.ends_with('>')) {
                (Some(open), true) => (rest[..open].trim(), rest[open + 1..rest.len() - 1].trim()),
                _ => (rest, ""),
            };
            Some(AuthorActivity {
                author: Author { name: name.to_string(), email: email.to_string() },
                commits,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn head_line_parses() {
        let head = parse_head("1725000000\x1ffix(parser): count CRLF\n").unwrap();
        assert_eq!(head.at, 1725000000);
        assert_eq!(head.subject, "fix(parser): count CRLF");
    }

    #[test]
    fn shortstat_handles_missing_parts() {
        let s = parse_shortstat(" 2 files changed, 4 deletions(-)");
        assert_eq!(s, CommitStats { files_changed: 2, insertions: 0, deletions: 4 });
        let s = parse_shortstat(" 1 file changed, 1 insertion(+), 1 deletion(-)");
        assert_eq!(s, CommitStats { files_changed: 1, insertions: 1, deletions: 1 });
    }

    #[test]
    fn recent_records_with_and_without_stats() {
        let out = "\x1ea3f9c21\x1ffix: one\x1fMax\x1fmax@x.io\x1f1725000001\n\n 1 file changed, 2 insertions(+)\n\
                   \x1e7be0114\x1fMerge branch 'x'\x1fLea\x1flea@x.io\x1f1725000000\n";
        let commits = parse_recent(out);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].short_hash, "a3f9c21");
        assert_eq!(commits[0].stats.insertions, 2);
        assert_eq!(commits[1].author.name, "Lea");
        assert_eq!(commits[1].stats, CommitStats::default());
    }

    #[test]
    fn subject_may_contain_a_tab_and_a_pipe() {
        let out = "\x1eabc\x1fwith\ttab | pipe\x1fA\x1fa@x\x1f5\n";
        assert_eq!(parse_recent(out)[0].subject, "with\ttab | pipe");
    }

    #[test]
    fn oldest_of_several_roots() {
        assert_eq!(parse_oldest_timestamp("30\n10\n20\n"), Some(10));
        assert_eq!(parse_oldest_timestamp(""), None);
    }

    #[test]
    fn shortlog_lines_become_authors() {
        let out = "   120\tMax Muster <max@x.io>\n     3\tLegacy Bot\n";
        let authors = parse_shortlog(out);
        assert_eq!(authors.len(), 2);
        assert_eq!(authors[0].commits, 120);
        assert_eq!(authors[0].author.name, "Max Muster");
        assert_eq!(authors[0].author.email, "max@x.io");
        assert_eq!(authors[1].author.name, "Legacy Bot");
        assert_eq!(authors[1].author.email, "");
    }
}
