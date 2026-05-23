# Visual Notes — Claude Code plugin

Optional companion plugin for the Visual Notes concept-map system. It is not the
normal session-summary trigger. The current trigger is an AI-client
`obsidian-notes` skill that writes an AI session summary markdown document from
the agreed template; the Obsidian Visual Notes plugin then extracts and renders
the visual.

This companion plugin is reserved for future workflows where an agent
deliberately curates or pins a graph sidecar instead of relying on automatic
plugin extraction.

The companion **Obsidian plugin** is the primary way to use Visual Notes (see
[`../obsidian-plugin/README.md`](../obsidian-plugin/README.md)). This Claude Code
plugin is **optional**: it may become useful when you want agent-curated graph
nodes for specific sessions, but the Obsidian plugin's auto-extraction handles
the common case without it.

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
