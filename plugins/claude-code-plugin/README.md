# Visual Notes — Claude Code plugin

Companion plugin for the Visual Notes concept-map system. Provides:

- A **PostToolUse hook** on `obsidian append` that nudges agents to update the
  daily-overview visual after writing session summaries.
- A **`visual-notes` skill** that documents the sidecar JSON schema and design
  heuristics, so agents can produce well-structured graph data when they
  pre-populate the sidecar.

The companion **Obsidian plugin** is the primary way to use Visual Notes (see
[`../obsidian-plugin/README.md`](../obsidian-plugin/README.md)). This Claude Code
plugin is **optional**: it's useful when you want agent-curated graph nodes
for specific sessions, but the Obsidian plugin's auto-extraction handles the
common case without it.

## Status

🚧 **Migration pending.** Existing implementation lives in a private dotfiles
repo and is being ported here. Until then, the manifest and directory
structure are scaffolded but the hooks/skills are placeholders.

See [`../../docs/design.md`](../../docs/design.md) for the remaining migration
plan and open decisions.

## Install (after migration)

```
/plugin install bobthearsonist/visual-notes/plugins/claude-code-plugin
```

## License

MIT — see [`../../LICENSE`](../../LICENSE).
