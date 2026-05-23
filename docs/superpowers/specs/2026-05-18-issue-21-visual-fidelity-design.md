# Issue #21 — Visual Fidelity Pass

**Status:** approved design, ready for implementation plan
**Date:** 2026-05-18
**Branch:** `feat/issue-21-visual-fidelity` (worktree at `~/Repositories/visual-notes-issue-21`)
**Issue:** https://github.com/bobthearsonist/visual-notes/issues/21
**Side-by-side previews:** [`samples/2026-05-18-issue-21-current-plugin-style.html`](samples/2026-05-18-issue-21-current-plugin-style.html) · [`samples/2026-05-18-issue-21-proposed-style.html`](samples/2026-05-18-issue-21-proposed-style.html)

## 1. Goal and constraints

**Goal.** Bring the plugin's daily-overview rendering up to legacy hook-rendered quality on two axes: **visual styling** (organic node sizing, calmer edge labels, hover interactivity) and **layout fidelity** (trust the narrative positions Claude already produces, only repair specific defects).

**Constraints** (from issue + brainstorm):

- Don't modify existing work artifacts under `0 Profisee/...`.
- Don't reintroduce the legacy iframe / `regenerate.py` path.
- Preserve standalone-plugin architecture: works for any watched markdown.
- Preserve current Obsidian theme-var integration (CSS reads `--background-primary` etc.); don't regress to hardcoded colors.
- Pinned sidecars (`_pinned: true`) remain untouched by all layout logic.

**Out of scope** (deliberate split, will be follow-up issues):

- Overlay header/legend placement
- Custom theme-var layer
- Narrative-aware deterministic layout
- Retroactive re-layout of existing sidecars
- Fullscreen "big mode" leaf-view

**Acceptance criteria:**

1. Plugin-rendered daily overview visually resembles legacy in spacing, node sizing, edge readability, legend/header treatment.
2. Existing work `whiteboard.html` / `*-overview.html` files remain untouched.
3. Plugin tests/build continue to pass.
4. Documentation explains the difference between legacy static HTML artifacts and the plugin-rendered path.

## 2. Styling changes — Core trio + zoom polish

**File:** `plugins/obsidian-plugin/src/renderer.ts` — `createStyle()` method.

### Node style block

```diff
- height: 54,
- width: 118,
- padding: "12px",
+ width: "label",
+ height: "label",
+ padding: "12px",
+ "text-max-width": "100px",
- "font-size": 13,
- "font-weight": 600,
+ "font-size": 11,
+ "font-weight": 500,
```

Nodes size to label content. Long labels grow; short labels stay compact. `text-max-width: 100px` caps single-line sprawl. Font drops to 11px/500 matching legacy density.

### Edge style block

```diff
- "font-size": 14,
- "font-weight": 700,
- "text-background-opacity": 0.95,
- "text-background-padding": "5px",
+ "font-size": 11,
+ "font-weight": "normal",
+ "text-background-opacity": 0.92,
+ "text-background-padding": "4px",
- width: 2,
+ width: 2.5,
- "curve-style": "bezier",
+ "curve-style": "straight",
```

Edge labels stop shouting. Edge widths become `2.5 / 3.5 / 1.5` (base / strong / weak) — lighter than the legacy template's `4 / 5 / 3` after a QA pass revealed those felt overweight against label-sized nodes at typical zoom. `curve-style` switches from `bezier` to `straight` because cytoscape 3.28.1 renders bezier edges as zero-size bounding boxes in our setup (confirmed via DOM inspection in Obsidian; see also QA notes in the PR description). Both QA-discovered values land in the final commit of the PR rather than the initial styling commits.

### Cytoscape init

```diff
  this.cy = cytoscape({
    container: graphEl,
    elements,
    layout: { name: "preset", fit: false },
    style: this.createStyle(),
    minZoom: 0.1,
    maxZoom: 3,
+   wheelSensitivity: 0.3,
  });
```

### Hover edge highlighting — new method

```typescript
private bindHoverInteractions(): void {
  if (!this.cy) return;
  const highlight = getCssVariable(
    getComputedStyle(this.containerEl),
    "--interactive-accent",
    "#2563eb",
  );
  this.cy.on("mouseover", "node", (evt) => {
    evt.target.style("border-width", 4);
    evt.target.connectedEdges().style({
      "line-color": highlight,
      "target-arrow-color": highlight,
      width: 5,
    });
  });
  this.cy.on("mouseout", "node", (evt) => {
    evt.target.style("border-width", 2);
    evt.target.connectedEdges().forEach((edge) => {
      edge.removeStyle("line-color");
      edge.removeStyle("target-arrow-color");
      edge.removeStyle("width");
    });
  });
}
```

Called from `renderGraph()` after cytoscape init. Uses Obsidian's native `--interactive-accent` (purpose-built highlight color, theme-aware) — no new CSS variable additions needed.

`mouseout` uses `removeStyle()` rather than re-reading class colors; Cytoscape's selector-based styles reapply automatically when inline styles are stripped.

### Out of scope

- Overlay header/legend placement (deferred follow-up).
- Custom theme-var layer like `--vn-edge-highlight` (deferred follow-up).

### No CSS file changes

`styles.css` requires no edits. All theme integration goes through `createStyle()` reading Obsidian CSS variables.

### Net delta

~25 lines modified in `renderer.ts`, 0 in `styles.css`.

## 3. Layout repair refactor

**File:** `plugins/obsidian-plugin/src/layout.ts`.

### Behavior change

Today, `applyDeterministicLayout` discards every LLM-provided position and re-lays out into a topology-driven grid. The new behavior: trust LLM positions; repair only specific defects.

```typescript
export function applyDeterministicLayout(sidecar: VisualNotesSidecar): VisualNotesSidecar {
  if (sidecar._pinned) return sidecar;
  return { ...sidecar, nodes: repairNodes(sidecar.nodes) };
}

function repairNodes(nodes: VisualNotesNode[]): VisualNotesNode[] {
  const withPositions = assignMissingPositions(nodes); // any node with no/zero position
  const clamped       = clampOffCanvas(withPositions); // x∈[-200,5000], y∈[-200,3000]
  return resolveCollisions(clamped);                   // <140×70 overlap → nudge apart
}
```

### Collision constants tuned for label-sized nodes

Today's `COLLISION_RADIUS_X = 120, COLLISION_RADIUS_Y = 95` assumes fixed 118×54 cards. With label-sized nodes, the conservative max size is:

- Width: `text-max-width 100px + padding 12px×2 ≈ 124px` → use **140px** (with slack)
- Height: `2 lines × 11px + padding 12px×2 ≈ 50px` → use **70px** (with slack)

### Drop (~600 lines of dead code)

`layoutFlatBoard`, `layoutComponent`, `packComponents`, `optimizeFlatBoardOrder`, `improveFlatBoardOrder`, `flatBoardCost`, `orderComponentNodes`, `selectAnchor`, `columnCountForComponent`, `findSingletonStoryTarget`, `buildVisualComponents`.

### Keep

`calculateLayoutMetrics` and its helpers (`countEdgeCrossings`, `boundsForPositions`, `calculateCentroid`, etc.) remain exported. Their existing quality-gate tests still pass. Future quality-gate fallback (a follow-up issue) can re-use them.

### Existing sidecars

Sidecars already on disk have grid'd positions baked in. The new flow only applies on **new extractions or force-regenerate**. No retroactive re-layout in this PR — that's a follow-up issue with sync-vault safety considerations (see "Recent spend/conflict incident" in `docs/design.md`).

### Net delta

~600 lines deleted, ~80 added.

## 4. Tests

### `plugins/obsidian-plugin/test/feature/layout.test.ts`

Existing tests assume grid placement — they will fail and need rewriting.

New repair tests:

1. **Preserves well-placed positions.** Input with valid, non-colliding, in-bounds positions → output identical.
2. **Clamps off-canvas.** Node at `x=-500` → clamped to ≥ `-200`. Node at `y=4000` → clamped to ≤ `3000`.
3. **Separates colliding nodes.** Two nodes at the same position → second nudged by approximately `(COLLISION_RADIUS_X, 0)`; resulting distance ≥ collision radius.
4. **Assigns missing positions.** Node with `x:0, y:0` (treated as missing) and other nodes well-placed → assigned to a free slot near the centroid of placed nodes.
5. **Respects `_pinned`.** `_pinned: true` short-circuits even when positions are off-canvas.

### `plugins/obsidian-plugin/test/feature/renderer.test.ts` (extend or add)

1. Hover handler binds on render and unbinds on destroy (no listener leak).
2. Style block contains `width: "label"`, `height: "label"`, `wheelSensitivity: 0.3` at the configured locations.

### Fixtures

Use a real, narrative-positioned overview (e.g., copy of `20260515-overview.json`) as the "well-placed LLM positions" canonical fixture. Place at `test/fixtures/narrative-positioned-overview.json`.

## 5. Documentation updates

### `docs/design.md`

1. **"Layout strategy" section** — resolve the open A/B decision:

   > **Resolved in #21:** LLM positions are trusted, with a deterministic *repair pass* for collisions/off-canvas/missing positions. The grid-layout option was retired; `calculateLayoutMetrics` is retained for future quality-gate work.

2. **"Open decisions" table row `Layout algorithm`** — change "Keep preset positions; A/B force-directed" → "✅ Trust LLM positions + repair pass (decided in #21)".

3. **New section: "Legacy hook artifacts vs. plugin renderer"** — explain that `whiteboard.html` files under `0 Profisee/...` are historical artifacts from the prior agent-curated workflow and are not the future direction; future renders come from the Obsidian plugin reading sidecar JSON. This satisfies acceptance criterion 4.

### `README.md` and `plugins/obsidian-plugin/README.md`

Add a short paragraph each pointing to the new `docs/design.md` section for users curious about the difference.

## 6. Follow-up issues

Filed during brainstorm:

- [#22 — Decision nodes lack visible alternatives](https://github.com/bobthearsonist/visual-notes/issues/22) — observation from the proposed-style preview that decision-tagged nodes don't structurally show the alternatives considered. Prompt + possibly schema; independent of this PR.

To file when this PR ships:

1. **Overlay header/legend visual mode** — alternative inline-flex header/legend that floats over the canvas (legacy iframe look) as opt-in setting.
2. **Custom theme-var layer** — `--vn-edge-highlight` etc. on top of Obsidian's native vars for more granular customization.
3. **Narrative-aware deterministic fallback** — quality-gate path that runs current-style topology layout when LLM positions fail metric thresholds.
4. **Retroactive re-layout migration** — one-time pass on existing sidecars (with sync-vault safety, no Anthropic re-extraction cost).
5. **Fullscreen plugin view ("big mode")** — Obsidian leaf-view that mimics the iframe full-page experience.

## 7. Architectural decision rationale

### Why "trust LLM positions" rather than improving deterministic layout?

The plugin's extraction prompt (`prompts/extract-graph.md`) already coaches Claude on cluster columns (x ≈ 0-250, 450-700, 900-1150) and status/role tiers (top = hubs/decisions, middle = systems, bottom = context). Claude reads the prose and can identify the day's hub, narrative thread boundaries, and status tier per node. The current `applyDeterministicLayout` overrides those positions with a topology grid using degree/edge-crossing minimization signals — losing the narrative awareness Claude already paid tokens to produce.

Closing that gap deterministically would require re-implementing narrative awareness in TypeScript (status-tier Y banding, radial-from-anchor placement, story-chain detection). Estimated cost: 3-5 days of focused work, ~500-800 new lines of heuristic code with many edge cases, and the result would still trail Claude (which reads the actual prose). Stopping the override is 0.5-1 day and ships legacy-quality layout for free on new extractions.

### Why keep `applyDeterministicLayout` as the export name?

Backwards compatibility within the plugin source tree. `main.ts` and existing test files import this name. Renaming is a follow-up cleanup, not part of this PR's scope.

### Why use Obsidian's `--interactive-accent` for hover highlight?

It's purpose-built (used for buttons, links, callouts) and theme-aware (light/dark, custom themes). Adopting it gives full theme integration for free, no new CSS variable additions, no light/dark parity work.

### Why label-sized nodes despite the variability they introduce?

The legacy hook approach used `width: label, height: label` and the resulting variable-width nodes are the dominant visual cue of "organic, curated" boards. Fixed cards look industrial. Variability is the look the user is trying to recover.

## 8. Effort estimate

| Section | Effort (focused) | Risk |
|---|---|---|
| §2 Styling | 0.5 day | Low — small diffs, easy to revert per-item |
| §3 Layout repair | 0.5-1 day | Low-medium — collision algorithm needs care, but conservative constants reduce risk |
| §4 Tests | 0.5 day | Low — fixtures exist; new tests are small |
| §5 Docs | 0.5 day | Trivial |
| **Total** | **2-2.5 days** focused | Low overall |

## 9. Validation plan

Before merge:

1. `pnpm --filter obsidian-plugin lint && pnpm --filter obsidian-plugin typecheck && pnpm --filter obsidian-plugin test` all pass.
2. Manual: open today's overview (`/Users/dislexicmofo/SynologyDrive/Test/0 Daily ADHD Brain Logs/20260518.md`) in Obsidian after running force-regenerate; visually compare to PROPOSED preview HTML. Differences in cluster organization are expected (real LLM positions vs. hand-authored simulation); look for: label-sized nodes, calmer edge labels, hover edge highlight working.
3. Manual: open a pinned sidecar and confirm it is not affected by the repair pass.
4. Manual: confirm an existing grid'd sidecar still renders (just keeps its grid positions; no re-layout).

## 10. Open questions

None. All scope decisions resolved in brainstorm:

- WIP handling: parked on `feat/visual-notes-codeblock` branch in `~/Repositories/visual-notes-codeblock` worktree.
- PR scope: (1) styling parity + (2) trust LLM positions; (3) "big mode" and overlay header out of scope.
- Styling specifics: Core trio (label-sized nodes, quieter edge labels, hover edge highlighting) + `wheelSensitivity: 0.3`; overlay legend out; custom theme-var layer out.
- Layout heuristic: repair-only pass (option 1 from brainstorm).
- Existing sidecars: not retroactively re-laid out in this PR.

## Reference links

- Issue: https://github.com/bobthearsonist/visual-notes/issues/21
- Existing design notes: [`docs/design.md`](../../design.md)
- Extraction prompt (already produces narrative positions): [`plugins/obsidian-plugin/prompts/extract-graph.md`](../../../plugins/obsidian-plugin/prompts/extract-graph.md)
- Side-by-side previews: [`samples/`](samples/)
