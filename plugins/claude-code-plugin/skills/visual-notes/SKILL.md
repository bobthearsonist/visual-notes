---
name: visual-notes
description: >-
  Create, refresh, or repair the inline visual-notes concept-map graph for an
  Obsidian session/daily note — either agent-authored (write the sidecar; a hook
  conforms + pins it) or plugin-extracted (the Obsidian plugin's LLM). Use at
  session boundaries (called by obsidian-notes), for rollup/retro visuals, or
  when a graph won't render or a sidecar shows "malformed sidecar". Triggers:
  session visual, daily overview, update visual, rollup visual, visual summary,
  concept map, regenerate visual, sidecar.
---

# Visual Notes

Generate living visual concept maps that render inline in Obsidian notes via the
plugin's ```` ```visual-notes ```` code fence. Two engines can author the graph
(pick explicitly per invocation); three tiers organize it: session whiteboards,
daily overviews, and on-demand rollup views.

## Quick Reference

| Need | Do |
|---|---|
| Agent-authored visual (session or daily) | `/obsidian-visual-summary-agent` → write `{basename}-overview.json`; hook conforms + pins |
| Plugin-extracted visual | `/obsidian-visual-summary-plugin` → `obsidian open` the note, then the force-regenerate command |
| Quick inline sequence/flow mid-note | use the `diagrams` skill (Mermaid) — not this skill |
| Rollup / retro / project overview | this skill → "Workflow: Rollup Views" |

- **Canonical sidecar** (what the fence reads): `{markdown-basename}-overview.json` — daily `{YYYYMMDD}-overview.json`, session `{YYYY-MM-DD topic}-overview.json`.
- **`_pinned: true`** = agent-authored is authoritative (plugin extractor stands down). **Force-regenerate** = plugin owns it (unpinned).
- The sidecar MUST pass the plugin's strict schema or the fence shows **"malformed sidecar"** — see Sidecar JSON Format + Common Mistakes.

## Generating the visual — two engines, chosen explicitly (no default)

Every session/daily note carries a ```` ```visual-notes ```` fence. The Obsidian
plugin renders the sibling `{basename}-overview.json` sidecar inline. That ONE
sidecar can be produced by either engine — **pick per invocation, never silently
default**:

| Mode | Builds the graph | Invoked by | Result |
|---|---|---|---|
| **agent** | the AI agent, from full session context (richer) | `/obsidian-visual-summary-agent` | agent writes a loose sidecar → PostToolUse hook conforms it to the strict schema + stamps `_pinned:true` → plugin stands down → fence renders it |
| **plugin** | the plugin's own LLM extractor | `/obsidian-visual-summary-plugin` | `obsidian open` the note, then `obsidian eval` runs `executeCommandById('visual-notes:regenerate-current-note-force')` (overrides any pin; result is unpinned, plugin-owned) |

`_pinned` is the per-document selector: **pinned** = agent-authored is
authoritative (plugin extractor stands down); **unpinned / force** = plugin owns
it. To hand a doc back to the agent, re-run agent mode — the hook re-pins.

### Agent mode — what you write

Write the sidecar at the canonical path (`.md` stripped, `-overview.json` appended):

- Daily overview: `{vault}/{daily_folder}/{YYYYMMDD}-overview.json`
- Session whiteboard: `{vault}/{sessions_folder}/{YYYY-MM-DD topic}/{YYYY-MM-DD topic}-overview.json`

Author in the friendly shape (see "Sidecar JSON Format" below); the hook coerces
it to the plugin's strict schema and pins it. Staying close to the strict rules
avoids lossy coercion.

### What the hook does (regenerate.py — you don't)

After your Write of a `*-overview.json` inside the vault, the PostToolUse hook:

1. **Conforms** the graph to the plugin's strict schema — kebab-case node ids;
   node `classes` of `{system|task|decision} {completed|active|context|blocked}`;
   bounded `position`; edge `classes` `strong-edge`/`weak-edge` (or omitted);
   drops edges with unknown endpoints; strips unknown top-level keys.
2. Stamps `_pinned: true`, plus `_extractedBy` (`visual-notes-agent@<ver>`) and `_schemaVersion` provenance — so a sidecar records which engine wrote it and at what version (the plugin stamps `obsidian-plugin@<ver>` on its writes).
3. Writes the sidecar back in place (a filesystem write — does **not** re-trigger
   the hook), idempotently.
4. Emits a one-line summary with any coercion warnings.

The fence renders the JSON sidecar directly.

### Plugin mode — driving the extractor

```bash
obsidian open path="{sessions_folder}/{YYYY-MM-DD topic}/{YYYY-MM-DD topic}.md"
obsidian eval code="app.commands.executeCommandById('visual-notes:regenerate-current-note-force')"
```

Fire-and-forget: extraction runs async (~$0.006/run) and the fence re-renders when
the sidecar lands. `force` overrides any existing pin and writes an unpinned,
plugin-owned sidecar.

### Manual conform (testing / backfill)

```bash
python <plugin root>/skills/visual-notes/scripts/regenerate.py /path/to/{basename}-overview.json
```

The script accepts a path on argv when stdin is empty/TTY.

## Design Principles

Load [visual-heuristic.md](references/visual-heuristic.md) for the full decision table. Summary:

1. **Every edge has a label** -- the label IS the insight
2. **Hierarchy encodes importance** -- general concepts top/center, specifics at edges
3. **Max ~20 nodes per session, ~50 per daily** -- group into clusters if exceeding
4. **Semantic colors only** -- green=done, yellow=active, blue=context, red=blocked
5. **Shapes encode type** -- rectangle=system, ellipse=task, diamond=decision
6. **Cross-domain links are gold** -- dashed lines connecting different topic areas

## Workflow: Session Whiteboard (agent mode)

Called by `obsidian-notes` at session start/checkpoints/session end, in **agent
mode**. Sidecar: `{sessions_folder}/{YYYY-MM-DD topic}/{YYYY-MM-DD topic}-overview.json`.

### Session start

1. Find the vault path, daily folder and sessions folder in the config file named by
   the Visual Notes plugin's **Agent config file** setting (its `obsidian:` block:
   `vault_path`, `contexts.<name>.daily_folder`, `ai_session_folders`).
2. Use the session folder selected by `obsidian-notes`: `{sessions_folder}/{YYYY-MM-DD topic}/`.
3. Seed initial nodes from active context:
   - Read yesterday's daily note for unfinished `- [ ]` next steps -> `context` nodes
   - Check git status for active branches -> `context` nodes
   - If the user stated a goal for the session -> `active` node
4. Compute positions using [position-strategy.md](references/position-strategy.md).
5. Write `{YYYY-MM-DD topic}-overview.json`. The hook conforms + pins it; the fence renders it. (The sidecar is the source of truth — never reverse-parse rendered output.)

### Mid-session / session end

1. Read the existing `{YYYY-MM-DD topic}-overview.json` sidecar.
2. Add/update nodes and edges; mark completed outcomes `completed`, unresolved ones `active`/`blocked`.
3. Compute positions for new nodes; write the sidecar back. The hook re-conforms + re-pins.

## Workflow: Daily Overview (agent mode)

Called by `obsidian-notes` after the session document is written. Session
summaries are NOT appended to daily notes; the daily note surfaces them via date
tags plus its own `{YYYYMMDD}-overview.json` graph.

### First session of the day

1. Check if `{YYYYMMDD}-overview.json` exists — if not, create it.
2. Seed from active context: carry forward yesterday's `active`/`blocked` nodes; pull unfinished next-steps from yesterday's daily note and relevant session docs.
3. Write `{daily_folder}/{YYYYMMDD}-overview.json`. The hook conforms + pins; the daily note's existing `visual-notes` fence renders it.

### Subsequent sessions

1. Read `{YYYYMMDD}-overview.json` for current state.
2. Merge key nodes from the just-completed session (major outcomes, systems touched, decisions); add edges to existing overview nodes; mark completed green, new active yellow.
3. Offset the new session cluster ~450px right of existing content; write the sidecar back.

> **Plugin mode** for either tier: instead of authoring, run
> `/obsidian-visual-summary-plugin` on the target note (see "Generating the
> visual"). It overrides the pin and lets the plugin's extractor own the graph.

## Workflow: Rollup Views

Triggered by user request. Load [visual-heuristic.md](references/visual-heuristic.md) for template mappings.

1. **Parse the request** -- what type of rollup? What date range? What tag filters?
2. **Query data** -- use Obsidian CLI Dataview queries to pull session summaries matching the filters
3. **Extract structured data** -- outcomes, tools, tags, metrics, dates from the matching summaries
4. **Select visual type** -- from the rollup templates table in visual-heuristic.md
5. **Generate visual**:
   - For concept maps: author a `{basename}-overview.json` sidecar beside a rollup note that contains a ```` ```visual-notes ```` fence (same path + schema as any visual — see "Generating the visual" + "Sidecar JSON Format")
   - For polished infographics: invoke `infographic-syntax-creator` skill
   - For charts: use Mermaid via `diagrams` skill fast-path
6. **Place the visual** -- in the retro/overview note the user is creating

## Sidecar JSON Format (strict schema)

The plugin validates the sidecar with strict zod (`parseSidecar`); any violation
renders "malformed sidecar" instead of a graph. Author to this shape — the hook
also coerces toward it and stamps `_pinned: true` (you never write `_pinned`):

```json
{
  "title": "Bug 1234 review",
  "nodes": [
    {
      "data": { "id": "pr-5678", "label": "PR 5678\nnarrowed pre-check" },
      "classes": "task completed",
      "position": { "x": 200, "y": 150 }
    }
  ],
  "edges": [
    {
      "data": { "source": "pr-5678", "target": "bug-1234", "label": "fixes" },
      "classes": "strong-edge"
    }
  ]
}
```

Hard rules (enforced by the plugin; the hook coerces what it can, warns on the rest):

- **Top-level keys only:** `kind` (`daily-overview` | `session-whiteboard` | `rollup`), `title`, `header`, `subtitle`, `nodes`, `edges` (plus `_pinned`/`_extractedBy`/`_schemaVersion`, added by the hook). Unknown keys are stripped.
- **Node `data.id`:** kebab-case `^[a-z0-9]+(?:-[a-z0-9]+)*$`. **`data.label`:** non-empty (use `\n` for mid-label line breaks).
- **Node `classes`:** exactly one type + one status — `{system|task|decision} {completed|active|context|blocked}` (e.g. `"task completed"`, `"decision active"`).
- **Node `position`:** required — `x` in [-200, 5000], `y` in [-200, 3000].
- **Edge `data`:** `source`/`target` must reference existing node ids; `label` non-empty (a verb phrase: `caused`, `resolves`, `fixes`).
- **Edge `classes`:** optional — only `strong-edge` or `weak-edge` (anything else is dropped).
- **Counts:** `nodes` 1–50, `edges` ≤100.

Node/edge `data` may carry extra keys (e.g. `sourcePath`) — only `id`/`label`
(nodes) and `source`/`target`/`label` (edges) are validated; the rest passes
through. Use `\n` inside a label for line breaks.

## Common Mistakes

| Mistake | Result | Fix |
|---|---|---|
| Edge `classes: "edge"` (anything but `strong-edge`/`weak-edge`) | class dropped; if hand-strict, "malformed sidecar" | use `strong-edge`/`weak-edge`, or omit `classes` |
| Node missing / out-of-bounds `position` | "malformed sidecar" | every node needs `position`, `x`∈[-200,5000] `y`∈[-200,3000] (the hook grid-fills, but layout suffers) |
| Non-kebab node `id` (spaces, capitals) | "malformed sidecar" | kebab-case ids; reference the SAME id from edges |
| Edge `source`/`target` to a missing node | edge silently dropped (graph gaps) | every endpoint must match a node `id` |
| Empty node or edge `label` | "malformed sidecar" | labels non-empty — the label IS the insight |
| Extra top-level key (`metadata`, `count`, …) | "malformed sidecar" | only `kind/title/header/subtitle/nodes/edges`; the hook strips others |
| Editing the sidecar of an unpinned (plugin-owned) doc | plugin re-extracts and overwrites you | run agent mode (re-pins), or accept plugin ownership |
| Reverse-parsing rendered output to recover the graph | drift/corruption | the `{basename}-overview.json` sidecar is the single source of truth |

## Theme Reference

Load [theme.json](references/theme.json) for the color/shape mapping. You don't
apply theme yourself — the plugin's renderer detects light/dark and maps node
`classes` to colors and shapes. Your job is correct `classes` (status → color,
type → shape).

## File Naming

One sidecar per note — `{markdown-basename}-overview.json`, beside the note:

| Tier | Sidecar pattern | Example |
|---|---|---|
| Daily overview | `{daily_folder}/{YYYYMMDD}-overview.json` | `Daily Notes/20260603-overview.json` |
| Session whiteboard | `{sessions_folder}/{YYYY-MM-DD topic}/{YYYY-MM-DD topic}-overview.json` | `AI Sessions/2026-06-03 dual-engine/2026-06-03 dual-engine-overview.json` |
| Rollup / retro | `{context}-retro-overview.json` (beside `{context}-retro.md`) | `2026-W16-retro-overview.json` |

### Why this name (don't rename the sidecar)

The fence renders exactly `{markdown-basename}-overview.json` — the markdown path
with `.md` stripped and `-overview.json` appended (`renderer.ts`
`sidecarPathForMarkdownPath`, locked by `renderer.test.ts`). If that file is
absent, the fence renders nothing. Both engines write this same file; `_pinned`
records who owns it. Renaming the sidecar to anything else silently breaks
rendering.
