use std::collections::BTreeMap;

use tokei::{Config, Languages};

use crate::application::ports::CodeSizeSource;
use crate::application::AppError;
use crate::domain::analysis::{CodeSize, LanguageShare};
use crate::domain::repository::Repository;

/// Counts lines with tokei, in-process.
///
/// The library rather than the binary: a desktop app should not depend on a
/// tool being on the user's PATH, and the library walks the tree with the
/// same ignore rules the binary would use (`.gitignore`, `.ignore`,
/// `.tokeignore`).
#[derive(Debug, Default, Clone, Copy)]
pub struct TokeiCodeSize;

/// The counter's own ignore file, honoured when the repository ships one.
const TOKEI_IGNORE: &str = ".tokeignore";

/// What is left out when the repository has no `.tokeignore` of its own.
///
/// The point of a line count is the code someone wrote and maintains, so
/// everything a machine produced or fetched is out: dependency trees, build
/// output, caches, generated code and type declarations, lockfiles, fixtures,
/// stories and vector assets. Tests stay in — they are maintained code. The
/// list follows the `.tokeignore` the user keeps in their main project, minus
/// the paths specific to it.
///
/// A repository that ships its own `.tokeignore` gets exactly that and none
/// of this: the author's definition of their code outranks a default.
///
/// Every pattern starts with `**/` because tokei anchors its override globs
/// at the process's working directory, not at the walked root — a bare
/// `node_modules/` matches nothing under a repository somewhere else on disk.
const DEFAULT_EXCLUDES: &[&str] = &[
    "**/node_modules",
    "**/.pnpm-store",
    "**/dist",
    "**/build",
    "**/out",
    "**/target",
    "**/.next",
    "**/.turbo",
    "**/.vite",
    "**/.cache",
    "**/coverage",
    "**/storybook-static",
    "**/playwright-report",
    "**/test-results",
    "**/vendor",
    "**/generated",
    "**/Generated",
    "**/__fixtures__",
    "**/__mocks__",
    "**/*.tsbuildinfo",
    "**/*.d.ts",
    "**/*.generated.*",
    "**/package-lock.json",
    "**/yarn.lock",
    "**/pnpm-lock.yaml",
    "**/Cargo.lock",
    "**/*.stories.tsx",
    "**/*.svg",
    "**/*.min.js",
    "**/*.min.css",
];

/// The language a user would name for what tokei reports.
///
/// tokei keys by syntax, so JSX and TSX are their own entries, and so are the
/// CSS preprocessors and the shells. Folding them keeps the bar about
/// languages rather than file extensions. Names not listed pass through, so
/// the value is `&'static str` only for the folded ones and leaks the
/// original otherwise — `Box::leak` on a handful of short names per scan is
/// the cheaper trade against threading an owned string through the map.
fn canonical_name(reported: &str) -> &'static str {
    match reported {
        "TSX" | "TypeScript" => "TypeScript",
        "JSX" | "JavaScript" => "JavaScript",
        "Sass" | "SCSS" | "Less" | "CSS" => "CSS",
        "Bash" | "Shell" | "PowerShell" | "Batch" | "Zsh" | "Fish" => "Shell",
        other => Box::leak(other.to_string().into_boxed_str()),
    }
}

impl CodeSizeSource for TokeiCodeSize {
    fn measure(&self, repository: &Repository) -> Result<CodeSize, AppError> {
        let root = repository.path().as_path();
        let excludes: &[&str] = if root.join(TOKEI_IGNORE).is_file() {
            &[]
        } else {
            DEFAULT_EXCLUDES
        };
        let config = Config::default();
        let mut languages = Languages::new();
        languages.get_statistics(&[root], excludes, &config);

        // `total()` sums the line counts but does not carry the per-file
        // reports over, so the file count is summed by hand.
        let total = languages.total();
        let files = languages.values().map(|l| l.reports.len() as u64).sum();
        // Merge by canonical name: tokei reports TSX and TypeScript apart,
        // which is a file extension, not a language the user thinks in.
        let mut by_name: BTreeMap<&'static str, u64> = BTreeMap::new();
        for (kind, language) in languages.iter() {
            *by_name.entry(canonical_name(&kind.to_string())).or_insert(0) += language.code as u64;
        }
        let per_language = by_name
            .into_iter()
            .map(|(name, code)| LanguageShare { name: name.to_string(), code })
            .collect();
        Ok(CodeSize::new(
            files,
            total.code as u64,
            total.comments as u64,
            total.blanks as u64,
            per_language,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::repository::RepoPath;

    #[test]
    fn counts_code_and_skips_the_defaults() {
        let base = std::env::temp_dir().join(format!("tablinum-tokei-{}", std::process::id()));
        std::fs::create_dir_all(base.join("src")).unwrap();
        std::fs::create_dir_all(base.join("node_modules").join("dep")).unwrap();
        std::fs::write(base.join("src").join("a.ts"), "const a = 1;\n// note\n\nconst b = 2;\n").unwrap();
        std::fs::write(base.join("src").join("b.rs"), "fn main() {}\n").unwrap();
        std::fs::write(base.join("node_modules").join("dep").join("i.js"), "x();\n".repeat(50)).unwrap();

        let repo = Repository::new(RepoPath::from_existing_dir(base.clone()), Some("main".into()));
        let size = TokeiCodeSize.measure(&repo).unwrap();
        assert_eq!(size.code, 3);
        assert_eq!(size.comments, 1);
        assert_eq!(size.blanks, 1);
        assert_eq!(size.files, 2);
        let names: Vec<&str> = size.languages.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["TypeScript", "Rust"]);

        std::fs::remove_dir_all(&base).unwrap();
    }
}
