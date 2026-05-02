# Visual Notes — Obsidian plugin

The primary artifact of the [Visual Notes](../..) project. Watches daily
notes in a configured folder, calls the Claude API to extract a concept-map
graph from the markdown, applies a deterministic layout pass, and renders an
interactive Cytoscape visual at the top of the rendered note view.

## Status

🚧 **MVP implementation in progress.** The plugin includes the Obsidian build
scaffold, settings tab, manual and watched-folder extraction, sidecar writing,
section-aware sidecar metadata, deterministic layout, pin/unpin/delete commands,
status-bar extraction count, token-usage metadata, and inline Cytoscape
rendering from the sidecar.

The top-level [`../../README.md`](../../README.md) has the product and
architecture overview. The living [`../../docs/design.md`](../../docs/design.md)
tracks remaining design work and open decisions.

## Install (after first release)

### Beta channel via BRAT (recommended during development)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) in Obsidian.
2. In BRAT settings, add this repository's path:
   `bobthearsonist/visual-notes`.
3. BRAT installs the plugin from the latest GitHub release whose tag exactly
   matches `manifest.json`'s version.

### Community plugin store (after first stable release)

Search "Visual Notes" in Obsidian → Settings → Community plugins.

## Release packaging

From the repository root, run:

```bash
pnpm package:obsidian
```

This builds the plugin and writes the Obsidian release assets to
`dist/obsidian-plugin`:

- `manifest.json`
- `main.js`
- `styles.css`

See [`../../docs/marketplace-readiness.md`](../../docs/marketplace-readiness.md)
for the release, tag, and marketplace submission checklist.

### Manual sideload (development)

```bash
cd ~/.obsidian/plugins/  # path to your vault's .obsidian/plugins dir
git clone https://github.com/bobthearsonist/visual-notes.git
cd visual-notes/plugins/obsidian-plugin
pnpm install
pnpm build
# Restart Obsidian, enable "Visual Notes" in Community plugins
```

## Configure

After install, open Settings → Visual Notes:

| Setting | What it does |
|---|---|
| **Anthropic API key** | Required. Get one at [console.anthropic.com](https://console.anthropic.com). Stored in plaintext `data.json` for this first pass. |
| **Watched folders** | A list of folders containing daily notes. **Empty by default** — add at least one for the plugin to do anything. Subfolders are searched recursively. Add multiple folders if you keep separate work/personal/project journals (e.g., `Captains Log`, `0 Daily ADHD Brain Logs`, `Projects/visual-notes/Journal`). Each folder produces its own sidecars in-place; same model, same prompt, same schema across all watched folders. |
| **Debounce (ms)** | How long to wait after the last save before extracting. Default: 1500ms. |
| **Model** | `claude-haiku-4-5` (default, ~$0.006/extraction) or `claude-sonnet-4-6` (~$0.02). |

Custom prompt override is **not exposed in v0.1** — the bundled extraction
prompt at `prompts/extract-graph.md` is the canonical heuristic source.
Advanced users wanting different extraction behavior can fork the plugin or
wait for the prompt-override field in a later release.

## How it works

```mermaid
sequenceDiagram
    participant User
    participant Obsidian
    participant Plugin
    participant API as Claude API

    User->>Obsidian: save daily note
    Obsidian->>Plugin: vault.on('modify')
    Plugin->>Plugin: debounce + hash check
    Plugin->>API: requestUrl /v1/messages
    API-->>Plugin: structured JSON (Zod-validated)
    Plugin->>Obsidian: write {date}-overview.json
    Obsidian->>Plugin: trigger MarkdownPostProcessor
    Plugin->>User: render Cytoscape inline
```

See the architecture overview in [`../../README.md`](../../README.md) and the
future-facing notes in [`../../docs/design.md`](../../docs/design.md).

## Cost

At the default Haiku model: **~$0.006 per extraction**. With debouncing and
content-hash dedup, expect **5-15 extractions per day** for an active note
schedule. Total: **~$2-5/month**.

Bring your own API key. The plugin does not proxy or aggregate usage.

## Sources of content

The plugin sees **everything** in the daily note:
- AI session summaries written by Claude Code, OpenCode, Copilot, etc.
- Manually typed notes
- Mobile edits synced via Obsidian Sync
- Templater-generated content
- Dataview query output (rendered text only)

If it's in the file, the LLM extraction sees it.

## Privacy / data handling

The plugin sends the **full markdown content** of the daily note to Anthropic's
API for extraction. By default, your notes do not stay on Anthropic's servers
beyond what's required for the API call (see [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy)).
Sensitive notes you don't want sent to a third-party API should not live
in any watched folder.

## License

MIT — see [`../../LICENSE`](../../LICENSE).
