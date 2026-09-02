/**
 * The locale every `Intl` formatter in the interface uses.
 *
 * Pinned rather than taken from the runtime: the interface language is English
 * (a product decision, see `.claude/rules/code-quality/comments-and-language.md`),
 * and a formatter left on the system locale prints "vor 20 Minuten" next to an
 * English label — mixed text that no string gate can see, because there is no
 * string. British English for day-first dates and a 24-hour clock, which read
 * unambiguously to the European users this app starts with.
 */
export const UI_LOCALE = "en-GB";
