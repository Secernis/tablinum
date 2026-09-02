/** How much of one language a repository holds, in lines of code. */
export interface LanguageShare {
  name: string;
  code: number;
}

/**
 * The size of a repository's code, as a line counter sees it.
 *
 * "Code" excludes comments and blank lines. Which files count is the
 * counter's business (ignore files, generated output), not the domain's.
 */
export interface CodeSize {
  files: number;
  code: number;
  comments: number;
  blanks: number;
  /** Every language found, largest first. */
  languages: LanguageShare[];
}

/** One segment of a language bar: a share of the code, as a fraction. */
export interface LanguageSegment {
  name: string;
  code: number;
  /** 0–1 of all code lines. */
  fraction: number;
}

/** The label of the segment that gathers everything below the cut. */
export const OTHER_LANGUAGES = "Other";

/** The label of the segment that gathers the data and configuration formats. */
export const DATA_LANGUAGES = "Data";

/** The label of the segment that gathers documentation formats. */
export const DOCS_LANGUAGES = "Docs";

/**
 * Formats a counter reports as languages but nobody programs in. They can be
 * a large share of a repository (a lockfile that slipped the ignore, an
 * exported dataset) and would otherwise sit among the languages as if they
 * were one — or vanish into "Other" and make it meaningless.
 */
const DATA_FORMATS = new Set([
  "JSON",
  "JSON5",
  "YAML",
  "TOML",
  "XML",
  "INI",
  "CSV",
  "Plain Text",
  "Text",
  "Protocol Buffers",
  "GraphQL",
  "SVG",
  "Dockerfile",
]);

/** Prose formats: documentation is worth seeing, but it is not the code. */
const DOC_FORMATS = new Set(["Markdown", "reStructuredText", "AsciiDoc", "Org", "TeX", "LaTeX"]);

/**
 * The languages worth a segment of their own, then the documentation and the
 * data formats as one segment each, and the rest folded into "Other".
 *
 * A bar with fifteen slivers says nothing; the top few say what the project
 * is written in. `limit` counts named language segments; the three groups
 * come on top of it and only when there is something to gather.
 */
export function languageSegments(size: CodeSize, limit = 4): LanguageSegment[] {
  if (size.code === 0) return [];
  const sum = (list: LanguageShare[]) => list.reduce((total, l) => total + l.code, 0);
  const programming = size.languages.filter((l) => !DATA_FORMATS.has(l.name) && !DOC_FORMATS.has(l.name));
  const docs = sum(size.languages.filter((l) => DOC_FORMATS.has(l.name)));
  const data = sum(size.languages.filter((l) => DATA_FORMATS.has(l.name)));
  const named = programming.slice(0, limit);
  const rest = sum(programming.slice(limit));

  const segment = (name: string, code: number) => ({ name, code, fraction: code / size.code });
  const segments = named.map((l) => segment(l.name, l.code));
  if (docs > 0) segments.push(segment(DOCS_LANGUAGES, docs));
  if (data > 0) segments.push(segment(DATA_LANGUAGES, data));
  if (rest > 0) segments.push(segment(OTHER_LANGUAGES, rest));
  return segments;
}
