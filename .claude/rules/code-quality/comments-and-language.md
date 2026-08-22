# Language

Enforced by: `english-comments` (write time), the `english-comments` sensor
(verify), `language-guard` (Stop), `language-anchor` (UserPromptSubmit).

## The split

| | Language |
| --- | --- |
| Chat, explanations, commit bodies | German |
| Code, identifiers, comments | English |
| Commit subjects | English |
| CHANGELOG entries | English |
| User-facing strings in the app | a product decision, out of scope here |

This is one rule with two directions, and both get confused.

**Code is English** because this repository is public. A German comment inside
otherwise portable code is unreadable to everyone who is not the person who wrote
it, and it is fine right up until it is not — at which point it is scattered
through the whole tree.

**Chat is German** because that is what the user reads. The drift is real and
gradual: a turn spent reading English source, English error messages and English
documentation ends in an English reply without anyone deciding to switch.

Technical terms and identifiers keep their original form inside German sentences.
`useState` is `useState`, not "Zustandshaken".

## Detection

A comment counts as German when it contains at least **two distinct** German
function words. One is not enough — German function words collide with English
identifiers and borrowed nouns ("die", "war", "hat" are all English words too).
Two distinct ones essentially never co-occur by accident in English prose, and
the quorum is calibrated against the cost of blocking a legitimate comment.

Test corpora are exempt: a fixture for a language detector necessarily contains
the language it detects.

## What a comment is for

The reason, not the mechanism. The code already says what it does.

```ts
// Resolve the nearest EXISTING ancestor and re-append the rest: realpath can
// only answer for a path that is on disk, and a Write creating a NEW file
// hands us one that is not.
```

versus

```ts
// Loop until realpath succeeds
```

The first survives a refactor. The second is a slower way to read the loop.

Moving an existing German comment stays free — the write-time gate judges what an
edit INTRODUCES. The legacy field is paid down deliberately.
