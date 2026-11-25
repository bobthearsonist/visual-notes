# Visual Notes — agent plugin

The agent side of the Visual Notes concept-map system, in the Claude Code plugin
format. Claude Code and GitHub Copilot CLI both load it. The companion
**Obsidian plugin** renders the graphs and can also extract them on its own (see
[`../obsidian-plugin/README.md`](../obsidian-plugin/README.md)); this plugin is for
when an agent authors and pins a graph itself.

It ships:

- `skills/visual-notes`: how to author a `{basename}-overview.json` sidecar.
- `commands/obsidian-visual-summary-agent` and `obsidian-visual-summary-plugin`:
  draw a note's graph from the agent's context, or ask the Obsidian plugin to
  extract it.
- A PostToolUse hook: after an agent writes or edits an `-overview.json` sidecar,
  `regenerate.py` conforms it to the plugin's strict schema and pins it, so the
  `visual-notes` fence renders the agent's graph. Needs `python` on `PATH`.

## Install

Add a marketplace that lists this plugin, then install it. For the
`bobthearsonist` marketplace:

```text
/plugin marketplace add bobthearsonist/ai
/plugin install visual-notes@bobthearsonist
```

Copilot CLI: `copilot plugin marketplace add bobthearsonist/ai`, then
`copilot plugin install visual-notes@bobthearsonist`.

## Configure which folders the hook acts on

By default the hook acts on any `-overview.json` inside an Obsidian vault. To
limit it to your daily and session note folders, point the Obsidian plugin's
**Agent config file** setting at a YAML or JSON file with an `obsidian:` block:

```yaml
obsidian:
  vault_path: /path/to/Obsidian   # root folder holding every vault
  default_vault: Main             # vault a context uses unless it sets `vault`
  contexts:
    work:
      vault: Main                 # optional
      daily_folder: Daily Notes
      ai_session_folders:
        - AI Sessions
```

Without `default_vault`, `vault_path` is treated as the vault itself (the older
single-vault form). The hook finds the vault from the sidecar's own path, reads that setting from the
vault's plugin settings, and reads the folders from the file. Keep the file
outside the vault and outside any published repo: it describes one machine. YAML
needs PyYAML or `yq`.

Claude Code users can switch the hook off with the plugin's
`visual_notes_enabled` option.

## License

MIT — see [`../../LICENSE`](../../LICENSE).
