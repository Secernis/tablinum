# Integration idea: work-item flow analytics

> Status: idea, not scheduled. Written 2026-09-24 from a real backlog analysis.

Tablinum reads Git histories. Most projects also keep a second history next to
Git: a tracker of work items (issues, tickets, roadmap items). This document
describes how Tablinum could read that second history and answer one question
that neither source answers alone:

**Is the backlog converging, or does every finished task create more than one new one?**

Everything below is tracker-neutral. It needs only a few timestamps per item,
and it maps onto GitHub Issues, Linear, Jira or a Postgres table as well.

---

## Minimum data model

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable item identity |
| `created_at` | yes | When the item was filed |
| `completed_at` | yes | When it reached its terminal "done" state, `NULL` while open |
| `archived_at` | optional | When it was dropped without completion |
| `status` | optional | Current status only; history is not assumed |
| `parent_id` | optional | The item it was spun off from |
| `container_id` | optional | Membership in a planned unit (board, sprint, milestone) |
| `category` | optional | Area / pillar / label for grouping |
| `priority` | optional | Only meaningful if it was chosen deliberately (see pitfalls) |

Most trackers store the **current** status and a completion timestamp, but no
status history. Every metric below works with that constraint.

---

## Metrics

The SQL is PostgreSQL against a generic `items` table plus an optional
`container_items (container_id, item_id)` membership table. Rename the columns
to match the source.

### 1. Open stock over time

How many items were open on each cut-off date. Open at date `D` means: created
before `D`, and neither completed nor archived before `D`.

```sql
WITH cutoffs AS (
  SELECT generate_series(
    date_trunc('month', (SELECT min(created_at) FROM items)),
    date_trunc('month', now()) + interval '1 month',
    interval '1 month'
  ) AS cutoff
)
SELECT
  c.cutoff::date AS cutoff,
  count(*) FILTER (
    WHERE i.created_at < c.cutoff
      AND (i.completed_at IS NULL OR i.completed_at >= c.cutoff)
      AND (i.archived_at  IS NULL OR i.archived_at  >= c.cutoff)
  ) AS open_items,
  count(*) FILTER (WHERE i.created_at   >= c.cutoff - interval '1 month' AND i.created_at   < c.cutoff) AS created_prev_month,
  count(*) FILTER (WHERE i.completed_at >= c.cutoff - interval '1 month' AND i.completed_at < c.cutoff) AS completed_prev_month
FROM cutoffs c CROSS JOIN items i
GROUP BY c.cutoff
ORDER BY c.cutoff;
```

Chart: a line for `open_items`, and paired bars for created vs completed per
period underneath.

### 2. Flow ratio per week

The key number. `completed / created` per week:

| Ratio | Meaning | Stock |
|---|---|---|
| below 1 | more filed than finished | grows |
| 1 | balanced | flat |
| above 1 | more finished than filed | shrinks |

```sql
SELECT
  date_trunc('week', e.at)::date AS week,
  count(*) FILTER (WHERE e.kind = 'created')   AS created,
  count(*) FILTER (WHERE e.kind = 'completed') AS completed,
  count(*) FILTER (WHERE e.kind = 'completed' AND e.planned) AS completed_via_container,
  round(count(*) FILTER (WHERE e.kind = 'completed')::numeric
        / nullif(count(*) FILTER (WHERE e.kind = 'created'), 0), 2) AS flow_ratio
FROM (
  SELECT created_at AS at, 'created' AS kind, false AS planned FROM items
  UNION ALL
  SELECT completed_at, 'completed',
         EXISTS (SELECT 1 FROM container_items ci WHERE ci.item_id = i.id)
  FROM items i WHERE completed_at IS NOT NULL
) e
GROUP BY 1
ORDER BY 1;
```

Chart: weekly ratio as a line with a reference line at 1.0. The trend of
`created` alone is often the earlier signal: a falling intake crosses the 1.0
line before the completion rate changes.

**Before/after comparison.** Split the series at the date a process change
landed (a new planning feature, a new workflow) and compare the two phases.
Tablinum can propose that date itself: it is the merge date of the commit that
introduced the change.

### 3. Planned vs. loose completion rate

Whether items in a planned unit (board, sprint, milestone) finish at a different
rate than items that were never planned.

```sql
SELECT
  CASE WHEN EXISTS (SELECT 1 FROM container_items ci WHERE ci.item_id = i.id)
       THEN 'planned' ELSE 'never planned' END AS kind,
  count(*) AS total,
  count(*) FILTER (WHERE completed_at IS NOT NULL) AS completed,
  count(*) FILTER (WHERE completed_at IS NULL AND archived_at IS NULL) AS open,
  round(100.0 * count(*) FILTER (WHERE completed_at IS NOT NULL) / count(*)) AS completion_pct
FROM items i
GROUP BY 1;
```

In the analysis this document grew from, planned items finished at 96 %, and
never-planned items at 34 %; 99 % of the open stock had never been planned. The
planned unit was the only real exit from the backlog.

### 4. Where the open stock sits

Open, never-planned items by category, with how many carry a high priority and
how many were spun off from another item.

```sql
SELECT
  coalesce(category, '(none)') AS category,
  count(*) AS open,
  count(*) FILTER (WHERE priority IN ('high', 'critical')) AS high_or_critical,
  count(*) FILTER (WHERE parent_id IS NULL) AS standalone,
  min(created_at)::date AS oldest
FROM items i
WHERE completed_at IS NULL AND archived_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM container_items ci WHERE ci.item_id = i.id)
GROUP BY 1
ORDER BY open DESC;
```

Chart: a horizontal bar per category, with the high/critical share highlighted.

### 5. Intake bursts

The days with the most new items, and how many of each burst are finished
today. It separates planning bursts, where a batch is filed and then worked off,
from discovery days, where findings are filed and stay.

```sql
SELECT
  created_at::date AS day,
  count(*) AS created,
  count(*) FILTER (WHERE completed_at IS NULL AND archived_at IS NULL) AS still_open,
  count(*) FILTER (WHERE completed_at IS NOT NULL) AS completed,
  count(*) FILTER (WHERE parent_id IS NOT NULL) AS with_parent
FROM items
GROUP BY 1
ORDER BY created DESC
LIMIT 15;
```

### 6. Spin-offs left behind

Open children of planned items that never joined a plan themselves: follow-up
work filed during planned work that outlived the plan.

```sql
SELECT
  ci.container_id,
  count(DISTINCT c.id) AS open_loose_children
FROM items c
JOIN items p            ON p.id = c.parent_id
JOIN container_items ci ON ci.item_id = p.id
WHERE c.completed_at IS NULL AND c.archived_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM container_items x WHERE x.item_id = c.id)
GROUP BY ci.container_id
ORDER BY open_loose_children DESC;
```

---

## What Git adds, the Tablinum-specific part

The tracker only knows when an item was **marked** done. Git knows when the work
**landed**. Together they expose what neither shows alone:

- **Unmarked completions.** In the source analysis, seven weeks recorded 6
  completions while dozens of branches merged. The work was done, but nobody
  marked it. Then one week recorded 263 completions at once, when a UI made
  marking cheap. A tracker-only chart reads that as a productivity spike; next
  to the merge history it reads as a marking backlog being cleared.
- **Completion lag.** If commits reference item ids (a trailer such as
  `Item: <id>`, or `#123` in the subject), the gap between the last referencing
  merge and `completed_at` is measurable per item.
- **Stale open items.** An open item whose referenced files or feature already
  exist in the tree is a candidate for "already done". Git can flag it; a human
  confirms it.
- **Process-change markers.** The merge that introduced a new workflow is a
  natural before/after split point for metric 2.

---

## Pitfalls, each met in practice

**`updated_at` does not mean "someone worked on it".** A migration that
back-fills a new column touches every row, and a `set_updated_at` trigger then
stamps every item as recently edited. Once, "never touched since creation"
counted exactly zero for every item older than a bulk migration. Never use
`updated_at` as an activity signal without checking for bulk writes.

**"Open" is not "backlog".** Without a status history, the status on a past date
cannot be reconstructed. "Open on date D" includes items that were in progress
then. Say so on the chart.

**A default priority is noise.** If the column defaults to `medium`, most items
end up `medium` whether anyone chose it or not; 64 of 70 sampled items did. Show
priority distributions only when the source enforces an explicit choice, or mark
them as unreliable.

**Capped API reads.** Many backends truncate list responses silently (PostgREST
at 1000 rows by default). A corpus of exactly the cap size is almost certainly
truncated. Read through the database or a paged endpoint, never a single
unpaged list call.

**Completion is marking, not working.** Every metric here measures when an item
was marked done. A process change that makes marking easier shows up as a
productivity change. The Git correlation above is the only honest check.

---

## Possible Tablinum surface

1. Connect a source: a Postgres connection string, or a tracker API token,
   stored in the OS keychain.
2. Map the fields of the minimum data model once per source.
3. A "Flow" view next to the Git history: open stock line, weekly flow ratio
   with the 1.0 reference, planned vs. loose split, and category bars.
4. Overlay markers from Git: merges, tags, and the commit that introduced a
   process change.
5. A weekly snapshot, so the trend is readable a week later without re-running
   anything.
