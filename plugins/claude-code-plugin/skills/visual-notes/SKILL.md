---
name: visual-notes
description: Concept-map visualization for daily notes. Documents the sidecar JSON schema and design heuristics so agents can pre-populate the visual when appending session summaries. The companion Obsidian plugin handles automatic extraction; this skill is for agent-driven pre-population only.
---

# Visual Notes (Claude Code skill)

> **Scaffold placeholder.** Migration of the full skill from the private
> dotfiles repo is pending. See [`../../../docs/design.md`](../../../docs/design.md)
> §5 for the migration plan.

## What this skill is for

When an AI agent is writing detailed session summaries to a daily note, the
agent can also write a sidecar JSON describing the day's concepts as a
graph. The Obsidian plugin renders that sidecar as a Cytoscape concept map
inline in the daily note view.

The sidecar schema is defined in [`shared/schema.json`](../../../../shared/schema.json).

## Workflow (post-migration)

1. After appending a session summary, read the daily note in full
2. Design a graph: nodes for major concepts, edges for relationships
3. Apply the design heuristics (see references)
4. Write the sidecar JSON next to the daily note as
   `{date}-overview.json`
5. The Obsidian plugin's file watcher will pick up the change and render
   the visual

## Heuristics (summary)

The full heuristics live in `references/visual-heuristic.md` (post-migration).
Quick summary:

1. Every edge has a label — the label IS the insight
2. Hierarchy encodes importance
3. Max ~30 nodes per overview; cluster if exceeding
4. Semantic colors: completed/active/context/blocked
5. Shapes encode type: system/task/decision
6. Cross-domain links are gold (use weak-edge / dashed style)

## Note on layering with the Obsidian plugin

If the Obsidian plugin is also installed, both producers can write the
sidecar. **Last writer wins.** For workflows where you want the agent's
curated graph to stick, set `_pinned: true` in the sidecar (future feature)
to suppress auto-extraction.
