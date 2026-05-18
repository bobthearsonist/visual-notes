---
name: visual-notes
description: Concept-map sidecar schema and heuristics for optional agent-curated Visual Notes graphs. The normal path is Obsidian plugin automatic extraction from watched markdown; this skill is for future pinned/curated sidecar workflows only.
---

# Visual Notes (Claude Code skill)

> **Scaffold placeholder.** Migration of the full skill from the private
> dotfiles repo is pending. See the living design document for the migration
> plan.

## What this skill is for

When an AI agent intentionally curates a graph, it can write a sidecar JSON
describing a note's concepts as a graph. The Obsidian plugin renders that
sidecar as a Cytoscape concept map inline in the note view.

This is not the normal session-summary trigger. Session summaries should be
created by the `obsidian-notes` skill using the AI session summary template,
then extracted/rendered by the Obsidian Visual Notes plugin.

The sidecar schema is defined in [`shared/schema.json`](../../../../shared/schema.json).

## Workflow (post-migration)

1. Read the target markdown note
2. Design a graph: nodes for major concepts, edges for relationships
3. Apply the design heuristics (see references)
4. Write the sidecar JSON next to the note as `{note-basename}-overview.json`
5. Set `_pinned: true` only when the agent is deliberately claiming ownership
6. The Obsidian plugin renders the visual from the sidecar

## Heuristics (summary)

The bundled extraction prompt at
`plugins/obsidian-plugin/prompts/extract-graph.md` is the canonical
source for these heuristics — both the Obsidian plugin and any
agent pre-populating a sidecar should follow them. Quick summary:

1. Every edge has a label — the label IS the insight
2. Hierarchy encodes importance
3. Max ~30 nodes per overview; cluster if exceeding
4. Semantic colors: completed/active/context/blocked
5. Shapes encode type: system/task/decision
6. Cross-domain links are gold (use weak-edge / dashed style)

## Note on layering with the Obsidian plugin

If the Obsidian plugin is also installed, both producers can write the
sidecar. **Last writer wins.** For workflows where you want the agent's
curated graph to stick, set `_pinned: true` in the sidecar to suppress
auto-extraction until the user unpins or force-regenerates.
