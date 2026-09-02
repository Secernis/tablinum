/// How much of one language a repository holds, in lines of code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LanguageShare {
    pub name: String,
    pub code: u64,
}

/// The size of a repository's code, as a line counter sees it.
///
/// "Code" excludes comments and blank lines; the three add up to every line
/// in a counted file. Which files count is the counter's business (ignore
/// files, generated output), not the domain's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeSize {
    pub files: u64,
    pub code: u64,
    pub comments: u64,
    pub blanks: u64,
    /// Every language found, largest first.
    pub languages: Vec<LanguageShare>,
}

impl CodeSize {
    /// Build a size from per-language counts, dropping empty languages and
    /// ordering by code so callers never sort twice.
    pub fn new(files: u64, code: u64, comments: u64, blanks: u64, mut languages: Vec<LanguageShare>) -> Self {
        languages.retain(|l| l.code > 0);
        languages.sort_by(|a, b| b.code.cmp(&a.code).then_with(|| a.name.cmp(&b.name)));
        CodeSize {
            files,
            code,
            comments,
            blanks,
            languages,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn languages_are_largest_first_without_empties() {
        let size = CodeSize::new(
            3,
            30,
            0,
            0,
            vec![
                LanguageShare { name: "CSS".into(), code: 5 },
                LanguageShare { name: "Rust".into(), code: 0 },
                LanguageShare { name: "TypeScript".into(), code: 25 },
            ],
        );
        let names: Vec<&str> = size.languages.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["TypeScript", "CSS"]);
    }
}
