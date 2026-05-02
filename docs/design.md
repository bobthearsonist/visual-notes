# Visual Notes — Design Document

**Version:** 0.1 (design phase)
**Date:** 2026-05-02
**Status:** Approved for implementation

> A system that watches daily-note markdown in Obsidian, extracts a concept-map
> graph via an LLM, and renders an interactive visual at the top of the note.
> Replaces an earlier Claude-Code-hook-driven approach that could only see
> content the agent passed through tool calls — leaving manual edits invisible
> to the visual.

---

## 1. Vision & Goals

### Why this exists

Today's daily-note workflow blends:

- AI-written session summaries appended via `obsidian append` (from Claude Code, OpenCode, and other AI clients)
- Manually-typed notes (meeting summaries, asides, status, ideas)
- Auto-generated content (Dataview queries, Templater output)

A previous iteration generated an iframe-embedded Cytoscape concept map by
having the AI agent write a JSON sidecar after each session. That worked but
**structurally cannot capture content the agent didn't write itself**. Manual
edits, content from other AI clients, and offline-typed mobile notes are all
invisible to the visual.

The plugin path makes the **markdown file the universal interface**: whoever
modifies it (Claude Code, claude.ai web/mobile, OpenCode, Cline, manual
typing on any device) → the plugin reacts and updates the visual.

### Goals

1. **Categorical completeness.** The visual reflects the entire day's content,
   not curated subsets.
2. **Cross-platform.** Runs wherever Obsidian runs (desktop + mobile).
3. **Cross-client decoupled.** Independent of which AI agent (if any) wrote
   the source content.
4. **Self-contained installable artifact.** A user with no Claude Code
   subscription can install just the Obsidian plugin and benefit.
5. **Deterministic rendering.** Same markdown → same visual structure (modulo
   layout). Visual quality is the LLM's responsibility but consistency comes
   from a fixed schema and prompt.

### Non-goals

- A general-purpose graph editor.
- Cross-note relationship visualization (that's ExcaliBrain's territory; we're
  scoped to per-note concept extraction).
- Real-time collaborative editing.
- A fancy settings dashboard (cost UI, model picker, prompt-template editor).
  Minimum viable settings: API key, watched folder, debounce ms.

---

## 2. System Architecture

### Three-component system

```
┌─────────────────────────────────────────────────────────────────┐
│                       The user's daily note                     │
│                  ~/Obsidian/.../Captains Log/                   │
│                                                                 │
│   ┌─────────────────────┐         ┌─────────────────────┐       │
│   │  20260501.md        │         │  20260501-          │       │
│   │  (markdown)         │◄────────│  overview.json      │       │
│   │                     │         │  (sidecar, written  │       │
│   │  contains an        │         │  by plugin or by    │       │
│   │  iframe pointing    │         │  Claude Code skill) │       │
│   │  at sibling .html   │         └────────┬────────────┘       │
│   └──────────┬──────────┘                  │                    │
│              │                             ▼                    │
│              │                    ┌──────────────────┐          │
│              └───────────────────►│ 20260501-        │          │
│                                   │ overview.html    │          │
│                                   │ (Cytoscape +     │          │
│                                   │  graph data)     │          │
│                                   └──────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                ▲                                ▲
                │                                │
   ┌────────────┴───────────┐    ┌───────────────┴──────────────┐
   │  Obsidian plugin       │    │  Claude Code plugin           │
   │  (this repo's primary  │    │  (this repo's secondary       │
   │  artifact)             │    │  artifact)                    │
   │                        │    │                               │
   │  - Watches markdown    │    │  - Hook on `obsidian append`  │
   │  - Calls Anthropic API │    │  - Optional skill telling     │
   │  - Writes sidecar JSON │    │    agents to write good notes │
   │  - Renders inline      │    │  - No longer the source of    │
   │    Cytoscape           │    │    truth for the visual       │
   └────────────────────────┘    └───────────────────────────────┘
```

The two plugins **share a JSON schema** (defined in `shared/schema.json`) for
the sidecar file. They do NOT need to be installed together — either alone
suffices for the user's workflow.

### Data flow: Obsidian plugin path (primary)

```
User saves daily note
      ↓
vault.on('modify') fires
      ↓
Debounce 1.5s (Obsidian's built-in debounce())
      ↓
Hash check: SHA-256 of markdown body vs. sidecar's _lastProcessedHash
      ↓
If unchanged → skip (handles Obsidian Sync's per-device modify storm)
If changed   ↓
      ↓
Anthropic Messages API call (Haiku 4.5 default)
  - System: extraction prompt + schema + few-shot examples
  - User: full markdown content
  - output_config: structured JSON via zodOutputFormat
      ↓
Parse response into typed object (zod-validated)
      ↓
Write {date}-overview.json sidecar (with new _lastProcessedHash)
      ↓
Trigger MarkdownPostProcessor refresh of the daily note's view
      ↓
Cytoscape mounts in MarkdownRenderChild container, reading the sidecar
```

### Data flow: Claude Code plugin path (legacy / complementary)

The existing Claude-Code-hook-driven system continues to work. When the agent
runs `obsidian append` to a Captain's Log file, a PostToolUse hook injects a
prompt asking the agent to update the visual. The agent reads the daily note
and writes the sidecar JSON directly. Last-writer-wins on the sidecar; either
system can populate it.

This is intentionally kept as a coexistence pattern, not a replacement: users
who don't have Claude Code installed still get full functionality from the
Obsidian plugin alone.

---

## 3. Shared Sidecar Schema

The contract between the two plugins. Lives at `shared/schema.json` as a
JSON Schema document; both plugins import it (the Obsidian plugin generates
TypeScript types via `json-schema-to-typescript`; the Claude Code plugin
references it in skill documentation).

### Format

```json
{
  "title":    "Daily Overview - 2026-05-01",
  "header":   "Daily Overview",
  "subtitle": "2026-05-01 — Hook fix · sidecar architecture · if-syntax decoded",
  "_lastProcessedHash": "sha256:abc123...",
  "_extractedBy": "obsidian-plugin@0.1.0",
  "nodes": [
    {
      "data": { "id": "kebab-id", "label": "Display\nLabel" },
      "classes": "system completed",
      "position": { "x": 250, "y": 200 }
    }
  ],
  "edges": [
    {
      "data": { "source": "id-a", "target": "id-b", "label": "verb phrase" },
      "classes": "strong-edge"
    }
  ]
}
```

### Field semantics

- `title` / `header` / `subtitle`: optional. Auto-derived from filename + date
  when omitted.
- `_lastProcessedHash`: SHA-256 of the markdown content the sidecar was
  generated from. Used to skip redundant API calls.
- `_extractedBy`: identifier for the producer (so debugging can attribute
  whether the Obsidian plugin or the Claude Code skill wrote a given sidecar).
- `nodes[].classes`: one type class + one status class.
  - **Type:** `system` (rectangle), `task` (ellipse), `decision` (diamond)
  - **Status:** `completed` (green), `active` (yellow), `context` (blue), `blocked` (red)
- `edges[].classes`: optional `strong-edge` (thick line) or `weak-edge`
  (dashed). Default is regular weight.
- `position`: pixel coordinates. **Currently provided by the LLM**; future
  versions may switch to Cytoscape's native layout (decision deferred — see
  §10 Open Questions).

### Versioning

Schema is at `v0.1.0` (matches initial repo version). Breaking changes bump
minor. Both plugins must agree on the schema version they support; the
sidecar gets an optional `_schemaVersion` field once we hit v1.0.

---

## 4. Obsidian Plugin Design

### 4.1 Components

```
plugins/obsidian-plugin/
├── manifest.json           # Plugin manifest (id, version, minAppVersion)
├── package.json            # npm dependencies
├── esbuild.config.mjs      # Build config (from obsidian-sample-plugin)
├── tsconfig.json
├── styles.css              # Plugin styles + Cytoscape container CSS
├── prompts/
│   └── extract-graph.md    # The structured-output prompt template
├── templates/
│   └── overview.html       # Cytoscape HTML template (placeholder substitution)
└── src/
    ├── main.ts             # Plugin entry, lifecycle, event registration
    ├── extractor.ts        # Anthropic API client, structured output
    ├── renderer.ts         # MarkdownPostProcessor, Cytoscape mount
    ├── settings.ts         # PluginSettingTab + persisted SettingsSchema
    ├── theme.ts            # Map Obsidian CSS vars → Cytoscape style
    ├── storage.ts          # API key storage (SecretStorage on desktop, data.json on mobile)
    ├── debounce.ts         # Wraps Obsidian's debounce() with content-hash dedup
    └── schema.ts           # Generated TypeScript types from shared/schema.json
```

### 4.2 Lifecycle

**Plugin load (`onload()`):**
1. Load settings from `data.json`
2. Initialize secure storage helper (probe `app.vault.getAdapter().getSecretStorage()`)
3. Register `PluginSettingTab`
4. Register `vault.on('modify')` event with debounced + hash-checked handler
5. Register `MarkdownPostProcessor` for files matching the watched-folder pattern
6. Register `app.workspace.on('css-change')` for theme refresh

**File save:**
1. `vault.on('modify')` fires
2. Path filter: only files in watched folder, only `.md` files (not the
   sidecar `.json` itself, which would create a feedback loop)
3. Pass to debounced handler (1.5s wait, configurable)
4. Hash check the markdown body; skip if unchanged from sidecar's
   `_lastProcessedHash`
5. Call `extractor.extract(markdownContent)`
6. Write sidecar JSON via `vault.modify()` (atomic write, triggers another
   modify event but the hash check prevents loop)
7. Notify any open MarkdownPostProcessor instances of the file to re-render

**Markdown view render (`MarkdownPostProcessor`):**
1. For each rendered daily note, check for sibling `{date}-overview.json`
2. If sibling exists, mount a `MarkdownRenderChild` at the top of the rendered
   markdown
3. The child loads the sidecar, applies theme variables, mounts Cytoscape
4. Cache the Cytoscape instance by file path (don't re-mount on every view)

### 4.3 LLM Integration

**SDK:** `@anthropic-ai/sdk` (official). Bundles cleanly, gives type-safe
`messages.parse()` for structured outputs, handles retry/backoff.

**Network call:** Use `requestUrl()` from Obsidian (CORS-safe in Electron),
not raw `fetch()`. The SDK can be wrapped to use `requestUrl` as its
transport — see Smart Connections plugin for reference pattern.

**Default model:** Claude Haiku 4.5. Concept extraction from markdown is a
pattern-matching/structural task, not deep reasoning. Cost: ~$0.006/call,
~$2/month at 10 calls/day. Sonnet 4.6 available as a settings opt-in for
users who want richer extraction at 3× cost.

**Structured output:** `messages.parse()` with `zodOutputFormat(GraphSchema)`.
Forces the response to match our Zod-defined schema; type-safe consumption
on the TypeScript side. Schema includes the same shape as `shared/schema.json`.

**Token budget:**
- Pre-flight `messages.countTokens()` before sending; reject notes over
  ~100k tokens (sanity guard).
- Typical daily note: ~1,250-3,750 input tokens.
- System prompt: ~2,000 tokens.
- Output: ~500-1,000 tokens.
- Total: ~3,250-5,750 input + ~750 output per call.

**Error handling:**
- 401 (auth) → Notice() popup, surface to user
- 400 (bad request) → log to console, Notice() popup
- 429 (rate limit) → silent exponential backoff, max 3 retries, then queue
  for next manual trigger
- 5xx / network → silent retry
- All other → log + queue

No streaming. Fire-and-forget extraction; render-when-done.

### 4.4 Rendering: Cytoscape inline

**Pattern:** `registerMarkdownPostProcessor()` → `MarkdownRenderChild` →
mount Cytoscape into a `<div>` injected at the top of the rendered note.

**Theme integration:** Read Obsidian CSS variables at mount time:
```typescript
const cs = getComputedStyle(document.documentElement);
const theme = {
  bg: cs.getPropertyValue('--background-primary').trim(),
  text: cs.getPropertyValue('--text-normal').trim(),
  accent: cs.getPropertyValue('--accent-color').trim(),
  // ... map to Cytoscape's style format
};
```

Subscribe to `app.workspace.on('css-change')` → rebuild Cytoscape style on
theme toggle (no re-mount needed, just `cy.style().fromJson(...).update()`).

**Caching:** Static `Map<filePath, Cytoscape>` instance cache. On
`MarkdownRenderChild.onload()`, check cache. On `onunload()`, evict.
Avoids re-mounting the (heavy) Cytoscape instance every time the view
re-renders.

**Sidecar reload:** When the sidecar JSON is rewritten by extraction,
load the new graph data into the cached Cytoscape instance via
`cy.json({ elements: { ... } })`. No HTML regeneration, no iframe
reload — just a Cytoscape data update.

**Why not iframe?** The legacy approach used a `file://` iframe with a
self-contained HTML file. Inside a plugin, we own the renderer — direct
Cytoscape mount is simpler, faster, theme-integrated, no sandbox concerns.

### 4.5 Settings UI

Minimum viable. `PluginSettingTab` with these fields:

| Setting | Type | Default | Storage |
|---|---|---|---|
| Anthropic API key | text (password style) | empty | SecretStorage on desktop, data.json on mobile (with warning) |
| Watched folder | text | `0 Profisee/Captains Log` | data.json |
| Debounce (ms) | number | 1500 | data.json |
| Model | dropdown (Haiku/Sonnet/Opus) | Haiku 4.5 | data.json |
| Custom prompt override | textarea, hidden behind a "show advanced" toggle | empty (uses bundled `prompts/extract-graph.md`) | data.json |

That's it. No cost UI, no per-folder configs, no model-comparison panel.

### 4.6 Sync collision handling

Multi-device problem: every device running Obsidian Sync sees its own
`vault.on('modify')` for the same change. Without dedup, N devices each
hit the API for the same content.

Solution: **content-hash dedup**.

```typescript
const hash = sha256(markdownContent);
const sidecar = await readSidecarIfExists(notePath);
if (sidecar?._lastProcessedHash === hash) {
  return; // Already extracted this exact content
}
const result = await extract(markdownContent);
result._lastProcessedHash = hash;
await writeSidecar(notePath, result);
```

This solves the most common sync race. Concurrent extraction from two
devices simultaneously is still possible but rare; last-writer-wins on
the sidecar is acceptable.

---

## 5. Claude Code Plugin Design

### 5.1 Components

```
plugins/claude-code-plugin/
├── .claude-plugin/
│   └── plugin.json         # Manifest (name, version, description)
├── hooks/
│   ├── hooks.json          # Wrapper format (PostToolUse → Bash matcher)
│   ├── post-obsidian-append.md  # Frontmatter + prompt body
│   └── run-hook.sh         # Generic hook runner; honors match_content frontmatter
└── skills/
    └── visual-notes/
        ├── SKILL.md        # Stripped-down: points users at the Obsidian plugin
        └── references/     # (optional, may stay empty post-migration)
```

### 5.2 Coexistence with Obsidian plugin

Both plugins write the same sidecar schema. The Claude Code path stays
useful for:

- Users who write detailed session summaries via AI clients and want the
  agent to control visualization narrative (e.g., highlight specific nodes)
- Workflows where the agent needs to inject curated graph state that the
  LLM extraction wouldn't produce automatically

The two systems compose:
1. Agent appends session summary to daily note
2. Obsidian plugin's file-watcher kicks in (debounced 1.5s)
3. Plugin extracts a fresh graph from the FULL note content
4. Sidecar gets overwritten with the LLM's view

OR (alternative ordering):
1. Agent appends session summary
2. Claude Code hook fires, agent writes sidecar with curated graph
3. Obsidian's debounced extraction triggers next, overwrites with LLM view

**Last writer wins** is acceptable because both producers target the same
schema and both are deterministic. If the user wants the agent's curated
graph to stick, they can disable the Obsidian extraction for specific notes
via a `_pinned: true` field in the sidecar (future feature).

### 5.3 Migration path

- **Phase 0 (today):** Claude Code plugin handles everything. Obsidian
  plugin doesn't exist yet.
- **Phase 1:** Obsidian plugin shipped, sidecar schema unchanged. Both
  systems coexist; user installs both.
- **Phase 2 (optional):** Strip the visual-notes skill down to a stub
  pointing at the Obsidian plugin. Claude Code plugin keeps the
  obsidian-append hook for note-writing assistance only.

---

## 6. The Extraction Prompt

Lives at `plugins/obsidian-plugin/prompts/extract-graph.md`. Bundled with
the plugin; user can override via settings (advanced).

### Structure

```markdown
You are extracting a concept map from an Obsidian daily note. Read the
markdown below and return a JSON object describing the day's main concepts
and their relationships.

# Heuristics (apply all)

1. **Every edge has a label.** The label IS the insight ("caused by",
   "blocks", "is part of", "led to"). No bare connections.
2. **Hierarchy encodes importance.** Central concepts have multiple edges;
   peripheral ones have one or two.
3. **Max 30 nodes total.** If the note covers more, group related items
   into cluster nodes labeled with a short summary like "build issues (4)".
4. **Semantic status colors:**
   - `completed` (green) — finished outcomes, decisions made
   - `active` (yellow) — in-progress work, open questions
   - `context` (blue) — background facts, references, dependencies
   - `blocked` (red) — explicitly stuck items
5. **Shape encodes type:**
   - `system` (rectangle) — tools, services, codebases, files
   - `task` (ellipse) — actions, work items
   - `decision` (diamond) — choices made, discoveries, design points
6. **Cross-domain links are gold.** When the note connects unrelated areas,
   surface those as weak edges (dashed style) — they're often the most
   interesting findings.

# Schema

Return JSON only, matching this structure:

{
  "title": "Daily Overview - YYYY-MM-DD",
  "subtitle": "<one-line summary of the day's themes>",
  "nodes": [
    {
      "data": { "id": "kebab-id", "label": "Display\nLabel" },
      "classes": "<type> <status>",
      "position": { "x": <int>, "y": <int> }
    }
  ],
  "edges": [
    {
      "data": { "source": "id1", "target": "id2", "label": "verb phrase" },
      "classes": "<strong-edge|weak-edge|>"
    }
  ]
}

# Layout

Place clusters in a horizontal sweep across the canvas. Each major theme
gets its own cluster (~250px apart vertically, 250px between nodes within
a cluster). Major clusters are separated by ~450px horizontally.

# Examples

[Two or three short markdown→JSON examples, ~100 words of markdown each]

# Markdown

{full_markdown_content}
```

### Few-shot examples

Two examples bundled:
1. A short engineering session (3-5 nodes, demonstrates type/status mapping)
2. A multi-cluster day (15+ nodes, demonstrates clustering + cross-domain
   weak edges)

These are the highest-leverage prompt-engineering investment. Iterate on
the examples first when extraction quality is off.

### Prompt-engineering anti-patterns to avoid

- ❌ "Best represent this as a concept map" → vague
- ❌ Generic node names like "Concept", "Idea", "Thing"
- ❌ Asking the LLM to determine "max nodes" itself
- ✅ Concrete constraints, schema with example values, explicit do/don't lists

---

## 7. Look & Feel

### Visual style

Cytoscape rendered with **Catppuccin** color palette (Latte for light,
Mocha for dark). Theme variables read from Obsidian's CSS at mount time.

| Status | Light bg | Light border | Dark bg | Dark border |
|---|---|---|---|---|
| `completed` | `#a6e3a1` | `#40a02b` | (mocha greens) | |
| `active` | `#f9e2af` | `#df8e1d` | (mocha yellows) | |
| `context` | `#89b4fa` | `#1e66f5` | (mocha blues) | |
| `blocked` | `#f38ba8` | `#d20f39` | (mocha reds) | |

### Shapes

- `system` — `round-rectangle`, padding 12px, label inside
- `task` — `ellipse`, padding 12px
- `decision` — `diamond`, padding 16px (more padding because diamonds visually
  shrink vs. rectangles at the same node-size setting)

### Edges

- Default — 2px solid, bezier curve, small triangle arrowhead
- `.strong-edge` — 3px, darker color, same shape
- `.weak-edge` — 1px dashed, lighter color, indicates cross-domain links

### Layout (current)

LLM produces explicit `{x, y}` positions following the prompt's layout
guidance. Cytoscape uses `layout: { name: 'preset' }` to honor them.

**Future:** A/B against `cose-bilkent` force-directed layout (let Cytoscape
position nodes; LLM only produces structure). Decision deferred — see §10.

### Interactivity

- Mouse hover on a node → bold border, highlight all connected edges
- Mouse out → restore default
- Pan with click-drag, zoom with wheel
- No node-drag (preset layout is authoritative)
- Min zoom 0.3, max zoom 3.0

### Header

Top-left corner of the canvas:
- `<h1>` with the `header` field (e.g., "Daily Overview")
- Subtitle below in muted text (e.g., "2026-05-01 — Hook fix · sidecar
  architecture")

### Legend

Top-right corner: small floating box with status dots (completed/active/
context/blocked) and shape labels (system/task/decision). Helps the user
parse the visual the first time they see it.

---

## 8. Repo Structure

```
visual-notes/
├── README.md                       # Top-level: project overview, install paths
├── LICENSE                         # MIT
├── .gitignore
├── pnpm-workspace.yaml             # Declares plugins/* and shared/ as workspaces
├── package.json                    # Root: dev tooling (typescript, eslint, prettier)
│
├── docs/
│   ├── design.md                   # THIS document
│   ├── architecture.md             # (Optional) deeper technical spec when impl starts
│   └── decisions/                  # ADR-style records as decisions accumulate
│       └── 0001-shared-schema.md
│
├── shared/
│   ├── schema.json                 # JSON Schema for sidecar
│   └── package.json                # Workspace package; generates TS types
│
└── plugins/
    ├── claude-code-plugin/
    │   ├── README.md               # Install: /plugin install ...
    │   ├── .claude-plugin/
    │   │   └── plugin.json
    │   ├── hooks/
    │   │   ├── hooks.json
    │   │   ├── post-obsidian-append.md
    │   │   └── run-hook.sh
    │   └── skills/
    │       └── visual-notes/
    │           └── SKILL.md
    │
    └── obsidian-plugin/
        ├── README.md               # Install: BRAT or community store
        ├── package.json
        ├── manifest.json
        ├── tsconfig.json
        ├── esbuild.config.mjs
        ├── styles.css
        ├── prompts/
        │   └── extract-graph.md
        ├── templates/
        │   └── overview.html       # (Optional, kept for legacy iframe path)
        └── src/
            ├── main.ts
            ├── extractor.ts
            ├── renderer.ts
            ├── settings.ts
            ├── theme.ts
            ├── storage.ts
            ├── debounce.ts
            └── schema.ts
```

### Why pnpm workspaces

- Shared schema package is consumed by both plugins; workspace symlinks
  avoid copying.
- Single root `node_modules` keeps disk usage and install time manageable.
- Per-plugin `package.json` keeps dependencies scoped (Obsidian plugin
  has Anthropic SDK + cytoscape; Claude Code plugin has nothing).

### CI/CD

`.github/workflows/`:
- `obsidian-release.yml` — on tag `obsidian-v*`: build, package, create
  GitHub release with `manifest.json` + `main.js` + `styles.css` as
  assets (BRAT/community-store consumable)
- `claude-code-release.yml` — on tag `claude-v*`: validate plugin.json
  schema, no build artifacts (Claude Code plugins distribute as git refs)
- `ci.yml` — on PR: typecheck, lint, validate JSON schemas

Path filters limit each workflow to its component's files.

### Versioning

**Independent.** Plugins evolve at different cadences. Tag prefix
distinguishes:
- `obsidian-v0.1.0` — Obsidian plugin release
- `claude-v0.1.0` — Claude Code plugin release
- `schema-v0.1.0` — Sidecar schema bump (forces both plugins to declare
  compatibility)

---

## 9. Implementation Phases

### Phase 1 — Scaffold + Obsidian plugin MVP (week 1)

- Repo scaffolded (this commit)
- Obsidian plugin skeleton: manifest, esbuild, plugin entry that registers
  a no-op MarkdownPostProcessor and PluginSettingTab
- Settings tab with API key field (plaintext, no SecretStorage yet)
- Manual command: "Visual Notes: Extract from current note" via the
  command palette. No file-watching, no debouncing.
- Anthropic SDK call → write sidecar JSON
- Verify happy path on one daily note end-to-end

### Phase 2 — Auto-extraction + rendering (week 2)

- File-watcher with debounce + content-hash dedup
- MarkdownPostProcessor mounts Cytoscape from sidecar JSON
- Theme integration (CSS vars → Cytoscape style)
- Caching: Map<filePath, cytoscapeInstance> with onload/onunload lifecycle

### Phase 3 — Settings polish + storage (week 3)

- SecretStorage on desktop, plaintext warning on mobile
- Watched-folder configurability
- Model dropdown (Haiku / Sonnet)
- Custom prompt override (textarea)

### Phase 4 — Distribution (week 4)

- BRAT release (tag `obsidian-v0.1.0-beta.0`)
- Submit to Obsidian community plugin store
- Document install paths in README

### Phase 5 — Claude Code plugin migration (week 5)

- Pull existing `~/ai/skills/visual-notes/` and `~/ai/hooks/` content
  into `plugins/claude-code-plugin/`
- Strip skill down to "the Obsidian plugin handles this; write good notes"
- Create `.claude-plugin/marketplace.json` for distribution
- Both plugins coexist; users can install either or both

### Phase 6 — Polish (ongoing)

- A/B test LLM-positioned vs `cose-bilkent` layout
- Cost-tracking widget (optional, originally cut from MVP)
- Multi-vault config
- More few-shot prompt examples

---

## 10. Open Questions / Decisions for the Implementation Team

### Layout algorithm

**Question:** Stick with LLM-produced positions (current schema), or strip
positions from the schema and use Cytoscape's `cose-bilkent` force-directed
layout?

**Decision:** **Stick with LLM positions for v0.1.** A/B against `cose-bilkent`
as a Phase 6 polish item. The LLM-positions approach preserves the
hand-crafted clustered layout the user has been using; switching costs
prompt re-engineering and a visual style change.

### Mobile API key UX

**Question:** Mobile can't use SecretStorage. Three options:
- (a) Plaintext in `data.json` with a stark warning
- (b) Disable extraction on mobile entirely
- (c) Require user to set up a separate mobile-scoped API key with
      reduced permissions

**Decision:** **(a)** for v0.1. Mobile users opt-in by entering the key,
warned in the settings description. Future: explore (c) when Anthropic
ships fine-grained API key scoping.

### Multi-vault config

**Question:** What if a user has multiple Obsidian vaults and wants
different settings per vault?

**Decision:** Out of scope for v0.1. Settings are per-vault by Obsidian
default (each vault has its own `.obsidian/plugins/<id>/data.json`).
That's good enough.

### Obsidian Sync race conditions

**Question:** Two devices simultaneously extract the same note. Each
writes a sidecar. Which wins?

**Decision:** Last-writer-wins via Obsidian Sync's natural file-merge
semantics. Content-hash dedup prevents the extraction from happening on
both devices in the common case (one device extracts first, sidecar syncs,
second device sees matching hash and skips).

### Custom prompts

**Question:** Should we support per-folder or per-tag prompt customization?

**Decision:** Out of scope. v0.1 is one global prompt. Power users can
override the whole prompt via settings.

---

## 11. References

### Obsidian Plugin Development

- [Obsidian Plugin Docs](https://docs.obsidian.md/Home)
- [Sample Plugin Repository](https://github.com/obsidianmd/obsidian-sample-plugin)
- [MarkdownPostProcessor reference](https://docs.obsidian.md/Reference/TypeScript+API/MarkdownPostProcessor)
- [PluginSettingTab reference](https://docs.obsidian.md/Reference/TypeScript+API/PluginSettingTab)
- [Vault API docs](https://docs.obsidian.md/Plugins/Vault)
- [Obsidian community plugin store submission](https://github.com/obsidianmd/obsidian-releases)
- [BRAT (Beta Reviewers Auto-update Tool)](https://github.com/TfTHacker/obsidian42-brat)
- [Juggl plugin (Cytoscape reference impl)](https://github.com/HEmile/juggl)

### Anthropic API

- [Claude API quickstart](https://platform.claude.com/docs/en/docs/quickstart)
- [Structured outputs guide](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Token counting API](https://platform.claude.com/docs/en/build-with-claude/token-counting)
- [Error handling reference](https://platform.claude.com/docs/en/api/errors)
- [Prompt engineering best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [Pricing](https://platform.claude.com/pricing)
- [`@anthropic-ai/sdk` npm](https://www.npmjs.com/package/@anthropic-ai/sdk)

### Claude Code Plugins

- [Claude Code plugin docs](https://code.claude.com/docs/en/plugins)
- [Plugin reference](https://code.claude.com/docs/en/plugins-reference)
- [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Hooks docs](https://code.claude.com/docs/en/hooks)
- [Anthropic's official marketplace](https://github.com/anthropics/claude-plugins-official)

### Cytoscape.js

- [Cytoscape.js docs](https://js.cytoscape.org/)
- [cose-bilkent layout](https://github.com/cytoscape/cytoscape.js-cose-bilkent)
- [cytoscape-css-variables extension](https://github.com/lukethacoder/cytoscape-css-variables)

### Tooling

- [pnpm workspaces](https://pnpm.io/workspaces)
- [json-schema-to-typescript](https://github.com/bcherny/json-schema-to-typescript)
- [Catppuccin palette](https://github.com/catppuccin/catppuccin)

---

## Appendix A — Glossary

| Term | Meaning |
|---|---|
| **Sidecar** | The `{date}-overview.json` file that lives next to the daily note, holding the extracted graph data. |
| **Watched folder** | The Obsidian folder the plugin monitors for daily-note changes. Default: `0 Profisee/Captains Log`. |
| **Daily note** | A markdown file named `YYYYMMDD.md` in the watched folder. |
| **Overview** | The visual concept map rendered for a daily note. |
| **Session** (legacy) | Per-conversation whiteboard `{date}-session-{n}.json` from the original visual-notes skill. May or may not be carried forward in v0.1. |

## Appendix B — Things explicitly cut from MVP

These are intentional non-goals for the first release. Documenting them so
future contributors don't relitigate.

- Cost transparency UI (running token spend display in settings)
- Streaming API responses
- Per-folder configs
- Per-tag configs
- Custom theme palettes
- Layout algorithm picker (deferred to Phase 6)
- Obsidian Canvas (.canvas) output format
- Native Obsidian Graph View integration
- Mind-map export
- PNG/SVG export of the rendered graph
- Bidirectional sync (visual edits writing back to markdown)
