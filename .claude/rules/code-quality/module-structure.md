# Module structure

Enforced by: `barrel-purity`, `suppression-gate`.

## Barrels re-export, they do not implement

`index.ts`, `index.tsx` and `mod.rs` exist to give a directory one public name.
The moment logic lands in one, three things break at once:

- **Cycle risk.** Every consumer of any sibling now imports the barrel's own
  code, so any sibling importing the barrel closes a loop.
- **Tree-shaking stops.** A barrel with side effects cannot be pruned, so
  importing one name pulls in everything.
- **It becomes the default home.** A file with no stated purpose is where things
  go when nobody decided where they belong.

Re-exports, type-only declarations and `use`/`mod` lines stay free. Put the code
in a named sibling and re-export it.

## A suppression states its reason

`@ts-expect-error`, `eslint-disable-next-line` and `#[allow(...)]` are legitimate
tools. What makes them expensive is that they are permanent and anonymous: the
check stops running at that line forever, and six months later nobody can tell
whether it was a considered exception or the fastest way past a red build.

So: a reason, on the same line or in a comment directly above.

```ts
// The upstream types model this as `any`; narrowing is the caller's job here.
// @ts-expect-error
```

Ten seconds now, against a reader who otherwise has to reconstruct the decision
from nothing.

### `@ts-expect-error`, never `@ts-ignore`

`@ts-ignore` suppresses **every** error on the next line, forever — including
ones introduced later that have nothing to do with the original reason.
`@ts-expect-error` fails once the error goes away, so it cannot outlive its
reason silently. That difference is the whole argument.

## Density

A docblock on every exported symbol, saying what it is for and why it exists in
this shape. Inline comments where a decision was made against a plausible
alternative — those are the lines a later reader will otherwise "simplify" back
into the bug they were written to avoid.

No comment restating the code. No commented-out code: that is what git is for,
and a commented-out block is a claim that something might come back, made by
someone who is not going to bring it back.
