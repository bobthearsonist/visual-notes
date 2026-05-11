# Visual Notes — Living Design Document

**Status:** living design notes for remaining and future work
**Last updated:** 2026-05-11

This document is intentionally future-facing. Product overview, current setup,
and the stable architecture summary live in the top-level
[`README.md`](../README.md). This file records design work that is still open,
planned, or likely to change.

## Design principles to preserve

These are the constraints future changes should not casually break:

1. **Markdown remains the universal input.** The Obsidian plugin reacts to
   watched `.md` files and does not require a specific AI client.
2. **The plugin does not modify note markdown.** It reads notes and writes a
   sibling sidecar (`{date}-overview.json`) only.
3. **The sidecar is the render contract.** The renderer consumes
   `shared/schema.json`; optional producers may write the same schema.
4. **Every edge label carries meaning.** A graph with unlabeled or generic
   edges is less useful than a smaller, accurate graph.
5. **Pinning is authoritative.** `_pinned: true` tells the Obsidian plugin not
   to overwrite a curated sidecar unless the user explicitly force-regenerates.

## Current implementation snapshot

The Obsidian plugin has an MVP implementation:

- settings tab for API key, watched folders, debounce, model, and optional
  Daily Context use
- watched-folder save handling with debounce
- content hash dedup via `_lastProcessedHash`
- Anthropic Messages API extraction through Obsidian `requestUrl`
- tool-based structured graph output validated with Zod
- sidecar writes stamped with producer/schema/hash/pin/usage metadata
- optional `daily-context` provider support that extracts from structured daily
  sources and stamps `_sourceContext` metadata
- inline Cytoscape rendering in Obsidian
- status bar extraction count
- command palette controls for extract, force-regenerate, pin, unpin, and
  delete sidecar

The Claude Code plugin remains scaffolded. Its full hook/skill migration is
future work.

## Remaining design work

### Section-aware updates

The sidecar schema can carry section provenance so extracted nodes and edges can
be traced back to markdown sections. Current extraction still reads the whole
note, but section metadata gives future updates a stable place to preserve
unchanged sections and strip ambiguous references.

Future design target:

- Re-extract only changed sections when the graph can be patched safely.
- Preserve stable node IDs across partial updates so existing layout and pins
  remain useful.
- Fall back to full-note extraction when:
  - headings are heavily reorganized
  - too many sections changed
  - a changed section participates in many cross-section edges
  - the sidecar schema version is older than the section-aware format

Open questions:

- Should section-level extraction return graph patches, or should the plugin
  ask Claude to merge old graph + changed markdown into a new full graph?
- How should manual edits to headings affect historical node IDs?

### Layout strategy

v0.1 uses LLM-provided `position: {x, y}` coordinates and Cytoscape's
`preset` layout. This keeps the prompt in control of visual grouping, but it
can produce overlaps or off-canvas nodes.

Future options:

1. **Keep LLM positions.**
   - Pro: preserves explicit semantic clustering.
   - Con: prompt quality directly affects readability.
2. **Switch to Cytoscape layout such as `cose-bilkent`.**
   - Pro: less prompt burden, likely fewer overlaps.
   - Con: may lose deliberate "daily narrative" placement.
3. **Hybrid approach.**
   - LLM returns clusters and ranks; Cytoscape computes positions inside
     cluster constraints.

Decision for now: keep preset LLM positions, but A/B against a force-directed
layout before a stable release.

Design tasks:

- Add a repeatable layout comparison fixture with the same sidecar rendered
  under preset and force-directed strategies.
- Decide whether `position` remains required in schema v1.
- Define behavior for nodes outside schema coordinate bounds.

### Marketplace and release planning

Obsidian plugin release path:

1. Finish MVP hardening.
2. Create a beta release consumable by BRAT.
3. Verify install/update behavior in a clean test vault.
4. Tag releases with an Obsidian-specific prefix, e.g. `obsidian-v0.1.0`.
5. Submit to the Obsidian community plugin store after beta feedback.

Claude Code plugin release path:

1. Migrate hook and skill content into `plugins/claude-code-plugin`.
2. Keep the skill focused on agent-curated sidecar pre-population, not on
   duplicating the Obsidian plugin's automatic extraction behavior.
3. Add marketplace metadata when the plugin is functional.
4. Tag releases with a Claude-specific prefix, e.g. `claude-v0.1.0`.

CI/CD still needs to be designed and added:

- PR checks for lint/typecheck/build.
- JSON schema validation.
- Obsidian release packaging for `manifest.json`, `main.js`, and `styles.css`.
- Claude Code plugin metadata validation.

### Future schema changes

Current schema supports:

- `kind`: `daily-overview`, `session-whiteboard`, `rollup`
- graph nodes with type/status classes and required positions
- labeled edges with optional strength classes
- section metadata/provenance for section-aware update workflows
- producer metadata (`_extractedBy`, `_schemaVersion`)
- extraction metadata (`_lastProcessedHash`, `_usage`)
- pinning (`_pinned`)

Potential schema evolution:

- Make `_schemaVersion` required at v1.
- Add section provenance for click-to-source and section-aware updates.
- Add stable cluster/group metadata separate from visual node classes.
- Add layout metadata so `position` can become optional or layout-specific.
- Add confidence/grounding fields for nodes and edges.
- Define producer ownership semantics if multiple producers cooperate on one
  sidecar.

Compatibility rule: renderers should warn and skip unsupported `kind` values
without deleting or rewriting data they do not understand.

### Claude Code companion migration

The companion plugin should not compete with automatic Obsidian extraction. It
should exist for workflows where an agent intentionally curates graph content.

Migration checklist:

- Port the existing hook runner and visual-notes skill from the private
  workflow.
- Update the skill to reference this repository's schema and extraction
  prompt as canonical heuristics.
- Ensure agent-authored sidecars use `_pinned: true` only when the agent is
  deliberately claiming ownership.
- Document how users recover from a stale curated sidecar: unpin or force
  regenerate in Obsidian.

### Privacy and storage

Current first pass stores the Anthropic API key in plugin `data.json`.

Future design work:

- Investigate Obsidian desktop secret storage support and mobile limitations.
- Decide whether mobile should keep plaintext storage, warn more strongly, or
  require a separate low-risk key.
- Consider per-folder warnings for sensitive folders.
- Add documentation for what is sent to Anthropic and when.

### Cost controls

Existing controls:

- watched folders default to empty
- debounce between saves
- semantic content hash dedup that ignores volatile frontmatter timestamps such
  as `modified` and `updated`
- force-regenerate cooldown
- status bar count
- usage metadata when available
- per-file in-flight extraction suppression, so a local modify storm cannot run
  overlapping API calls for the same note
- recent extraction history in the sidecar, including reason plus raw/semantic
  hashes, so spend spikes can be diagnosed from the generated JSON
- optional Daily Context source hashing, so overview extraction can be keyed to
  configured day sources instead of the entire raw daily note

Potential additions:

- Daily or monthly soft budget warnings.
- Per-folder extraction enable/disable.
- "Manual only" watched-folder mode.
- Token-count preflight using Anthropic's token counting endpoint instead of a
  character heuristic.
- Single-writer or device ownership controls for synced vaults, because multiple
  Obsidian instances on Synology Drive can still race to regenerate the same
  sidecar and produce `*_Conflict.json` files.

Recent spend/conflict incident:

- A personal daily sidecar recorded thousands of extractions and most of the
  month-to-date Anthropic spend.
- Synology Drive conflict files showed multiple machines regenerating the same
  `YYYYMMDD-overview.json` sidecars with different graph contents, hashes, and
  usage counters.
- The canonical markdown notes were not conflicted; the conflicts were generated
  visualization metadata.
- Root cause class: automatic extraction in a synced folder can treat timestamp
  churn or multi-device writes as meaningful changes unless dedupe is semantic
  and local extraction is serialized.

### Plugin-owned session visuals

The current AI skill workflow can append session summaries and also generate
`YYYYMMDD-session-N.json/html` whiteboards. The desired product direction is to
move visual ownership into the Obsidian plugin:

1. The AI skill writes only structured markdown session-summary text.
2. The plugin parses `## AI Session Summary - ...` sections from watched daily
   notes.
3. The plugin writes deterministic `session-whiteboard` sidecars for each
   summary and renders them inline below the corresponding summary heading.
4. The plugin aggregates session sidecars into the daily `daily-overview`
   sidecar and renders the daily visual at the top of the note.

This keeps markdown as the source of truth, avoids checked-in or synced HTML
artifacts, and lets the same renderer/layout validation protect both daily and
per-session visuals.

### Rendering and navigation polish

Open areas:

- Click node to jump to the best matching markdown heading or text span.
- Keyboard shortcuts for fit/reset.
- Better mobile canvas height and touch behavior.
- More accessible legend and ARIA labels.
- Placeholder states for missing API key, missing sidecar, malformed sidecar,
  unsupported sidecar kind, and stale pinned graphs.
- Multiple split panes showing the same file without duplicate containers or
  lifecycle leaks.

## Known limitations

- Full-note extraction can duplicate API spend during tight multi-device sync
  races.
- LLM-generated positions can overlap or produce less readable layouts.
- The plugin cannot guarantee graph quality; bad extraction requires manual
  regenerate or prompt/schema improvement.
- API key storage is plaintext in the current implementation.
- Claude Code companion hooks are scaffolded but not functional yet.
- The renderer currently supports daily overview sidecars; other `kind` values
  are reserved for future use.

## Open decisions

| Topic | Current leaning | Decision needed before |
|---|---|---|
| Section-aware extraction patches | Use sidecar section metadata; keep full-note fallback | schema v1 |
| Layout algorithm | Keep preset positions; A/B force-directed | stable release |
| API key storage | Improve desktop storage; document mobile caveat | public beta |
| Cost dashboard | Keep status count for MVP | after beta feedback |
| Claude Code pin defaults | Do not pin automatically | companion migration |
| Rollup/session sidecar rendering | Preserve schema values, skip in v0.1 renderer | adding those modes |

## Reference links

- [Top-level README](../README.md)
- [Obsidian plugin README](../plugins/obsidian-plugin/README.md)
- [Claude Code plugin README](../plugins/claude-code-plugin/README.md)
- [Shared schema](../shared/schema.json)
- [Extraction prompt](../plugins/obsidian-plugin/prompts/extract-graph.md)
- [Issue #4](https://github.com/bobthearsonist/visual-notes/issues/4)
