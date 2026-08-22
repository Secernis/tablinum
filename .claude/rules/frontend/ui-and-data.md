# The shipping UI

Enforced by: `mock-data`, `icon-imports`.

## No placeholder data

A component that renders `const repos = [{ name: "example-repo" }]` looks
finished. It builds, it screenshots well, and it is indistinguishable from a
working feature until someone runs it against reality.

That is exactly why it is expensive: placeholder data does not fail. It quietly
stands in for a data path nobody wrote, and the absence is discovered by whoever
trusted the screenshot.

For a Git client it is worse than average, because **the whole product is its
data**. A commit list wired to the real source reveals loading states, empty
states, error states and pagination on day one. A hardcoded one reveals none of
them until the feature is declared done.

Wire the component to the real source — a Tauri command, a store, a prop — even
when it returns nothing yet. An empty result is a real state worth designing.

Fixtures belong in `.stories.tsx` and tests, which are exempt. That is where they
are the point rather than a stand-in.

## One icon library

Icons come from `@tailgrids/icons`. That is a decision, not a default.

A second set costs three things at once: bundle weight in a desktop binary that
ships every byte, a visual seam where the two meet (stroke weights and optical
sizes never quite agree), and a maintenance surface where the same concept has
two names.

If an icon genuinely has no equivalent there, say which one and why. Adding a
dependency is a decision, not a workaround.

## Components stay dumb where they can

Rendering and data-fetching are different jobs. A component that reaches for its
own data cannot be rendered in a test, in a story, or in a second place with a
different source — and the second place always arrives.
