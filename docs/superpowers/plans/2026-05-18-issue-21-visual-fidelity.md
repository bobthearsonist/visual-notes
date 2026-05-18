# Issue #21 Visual Fidelity Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Obsidian plugin's daily-overview rendering up to legacy hook-rendered quality on two axes: visual styling parity (label-sized nodes, calmer edge labels, hover edge highlighting, smoother zoom) and layout fidelity (trust LLM positions; deterministic logic becomes a repair pass for collisions/off-canvas/missing only).

**Architecture:** Modify `plugins/obsidian-plugin/src/renderer.ts` `createStyle()` and add a hover handler in `renderGraph()` for styling parity. Refactor `plugins/obsidian-plugin/src/layout.ts` so `applyDeterministicLayout` becomes a thin `repairNodes` pipeline (missing → off-canvas → collisions) instead of a full topology-grid re-layout. Update the two contract scripts (`renderer-contract.mjs`, `layout-metrics.mjs`) so their hardcoded assertions match the new behavior. Keep `calculateLayoutMetrics` exported for future quality-gate work. Existing on-disk grid'd sidecars are not retroactively re-laid out — repair runs at extraction time only.

**Tech Stack:** TypeScript, Cytoscape.js 3.28, Obsidian Plugin API, esbuild, node:test runner (built-in), pnpm monorepo, vitest is NOT used.

**Working directory for this plan:** `/Users/dislexicmofo/Repositories/visual-notes-issue-21` (worktree on branch `feat/issue-21-visual-fidelity`)

**Spec:** [`docs/superpowers/specs/2026-05-18-issue-21-visual-fidelity-design.md`](../specs/2026-05-18-issue-21-visual-fidelity-design.md)

---

## Phase A — Layout repair refactor

Done first because (1) the test fixtures it produces are needed for Phase B's manual QA, (2) it has the largest blast radius (deletes ~600 lines) and is safest at the start of the branch, (3) styling changes in Phase B are reversible per-line and don't depend on layout.

### Task 1: Pre-flight verification

**Files:**
- None modified

- [ ] **Step 1: Confirm worktree, branch, and clean tree**

Run: `git -C /Users/dislexicmofo/Repositories/visual-notes-issue-21 status --short && git -C /Users/dislexicmofo/Repositories/visual-notes-issue-21 branch --show-current`

Expected:
```
feat/issue-21-visual-fidelity
```
(no uncommitted changes other than what this plan may leave)

- [ ] **Step 2: Install dependencies**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm install`

Expected: succeeds with no errors. If you see `node_modules` already, this is a no-op.

- [ ] **Step 3: Confirm baseline tests pass**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin test:feature`

Expected: all three existing test files pass (`daily-context.test.ts`, `hash.test.ts`, `sectioned-sidecar.test.ts`). If any fail, STOP — investigate and fix before proceeding.

- [ ] **Step 4: Confirm baseline validate scripts pass**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin validate`

Expected: typecheck + `validate:layout` + `validate:renderer` all pass.

- [ ] **Step 5: No commit (pre-flight only)**

---

### Task 2: Add narrative-positioned fixture

**Files:**
- Create: `plugins/obsidian-plugin/test/fixtures/narrative-positioned-overview.json`

- [ ] **Step 1: Create the fixtures directory if missing**

Run: `mkdir -p /Users/dislexicmofo/Repositories/visual-notes-issue-21/plugins/obsidian-plugin/test/fixtures`

- [ ] **Step 2: Copy the legacy whiteboard JSON as canonical "good positions" fixture**

Run:
```bash
cp "/Users/dislexicmofo/SynologyDrive/Test/0 Profisee/Captains Log/20260515-overview.json" \
   /Users/dislexicmofo/Repositories/visual-notes-issue-21/plugins/obsidian-plugin/test/fixtures/narrative-positioned-overview.json
```

This file contains 12 narrative-positioned nodes (PR #22074 / bug 156294 day) authored by the legacy hook. Acts as the canonical "well-placed LLM positions" input for repair-preserves tests.

- [ ] **Step 3: Verify fixture is valid JSON**

Run: `jq -r '.kind, (.nodes | length), (.edges | length)' /Users/dislexicmofo/Repositories/visual-notes-issue-21/plugins/obsidian-plugin/test/fixtures/narrative-positioned-overview.json`

Expected:
```
daily-overview
12
11
```

- [ ] **Step 4: Commit the fixture**

```bash
cd /Users/dislexicmofo/Repositories/visual-notes-issue-21
git add plugins/obsidian-plugin/test/fixtures/narrative-positioned-overview.json
git commit -m "test(obsidian): add narrative-positioned overview fixture

Copy of a legacy hook-authored overview (20260515 / PR #22074 day). Used
as the canonical 'well-placed LLM positions' input for layout-repair
tests in #21."
```

---

### Task 3: TDD — repair preserves well-placed positions

**Files:**
- Create: `plugins/obsidian-plugin/test/feature/layout.test.ts`
- Modify: `plugins/obsidian-plugin/src/layout.ts` (function `applyDeterministicLayout`)

- [ ] **Step 1: Write the failing test**

Create `plugins/obsidian-plugin/test/feature/layout.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { applyDeterministicLayout } from "../../src/layout";
import type { VisualNotesSidecar } from "../../src/schema";

const fixturePath = fileURLToPath(
  new URL("../fixtures/narrative-positioned-overview.json", import.meta.url),
);

async function loadNarrativeFixture(): Promise<VisualNotesSidecar> {
  const raw = await readFile(fixturePath, "utf8");
  return JSON.parse(raw) as VisualNotesSidecar;
}

describe("applyDeterministicLayout — repair pass", () => {
  it("preserves well-placed LLM positions unchanged", async () => {
    const sidecar = await loadNarrativeFixture();
    const before = sidecar.nodes.map((node) => ({
      id: node.data.id,
      x: node.position.x,
      y: node.position.y,
    }));

    const result = applyDeterministicLayout(sidecar);

    const after = result.nodes.map((node) => ({
      id: node.data.id,
      x: node.position.x,
      y: node.position.y,
    }));
    assert.deepEqual(after, before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin test:feature`

Expected: the new test fails with an inequality — `applyDeterministicLayout` rewrites the positions into a grid, so `after` differs from `before`.

- [ ] **Step 3: Replace the body of `applyDeterministicLayout` with a pass-through**

Open `plugins/obsidian-plugin/src/layout.ts`. Replace the existing `applyDeterministicLayout` function (lines ~91-100) with:

```typescript
export function applyDeterministicLayout(sidecar: VisualNotesSidecar): VisualNotesSidecar {
  if (sidecar._pinned) {
    return sidecar;
  }

  return { ...sidecar, nodes: repairNodes(sidecar.nodes) };
}

function repairNodes(nodes: VisualNotesNode[]): VisualNotesNode[] {
  // Repair pipeline grows in later tasks. For now, pass through.
  return nodes;
}
```

Leave the rest of the file (helpers, `calculateLayoutMetrics`, the dead `layoutNodes`/`layoutFlatBoard`/etc.) intact for now — Task 8 cleans up dead code.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin test:feature`

Expected: new test passes; the three existing tests still pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/dislexicmofo/Repositories/visual-notes-issue-21
git add plugins/obsidian-plugin/test/feature/layout.test.ts plugins/obsidian-plugin/src/layout.ts
git commit -m "feat(obsidian): begin repair-pass refactor; preserve well-placed positions

applyDeterministicLayout no longer rewrites positions for non-pinned
sidecars. First step of #21 layout work — passes well-placed LLM
positions through unchanged. Off-canvas, collisions, and missing
positions are still untouched (added in following commits)."
```

---

### Task 4: TDD — clamp off-canvas positions

**Files:**
- Modify: `plugins/obsidian-plugin/test/feature/layout.test.ts`
- Modify: `plugins/obsidian-plugin/src/layout.ts`

- [ ] **Step 1: Add the failing test**

Append to the `describe("applyDeterministicLayout — repair pass", () => { ... })` block in `plugins/obsidian-plugin/test/feature/layout.test.ts`:

```typescript
it("clamps positions outside schema bounds to the visible range", () => {
  const sidecar = makeSidecar([
    { id: "left",   classes: "system context", position: { x: -500, y: 100 } },
    { id: "right",  classes: "system context", position: { x: 6000, y: 100 } },
    { id: "high",   classes: "system context", position: { x: 200, y: -800 } },
    { id: "low",    classes: "system context", position: { x: 200, y: 4000 } },
    { id: "inside", classes: "system context", position: { x: 200, y: 200 } },
  ]);

  const result = applyDeterministicLayout(sidecar);
  const byId = new Map(result.nodes.map((n) => [n.data.id, n.position]));

  assert.equal(byId.get("left")!.x, -200, "left clamped to min x");
  assert.equal(byId.get("right")!.x, 5000, "right clamped to max x");
  assert.equal(byId.get("high")!.y, -200, "high clamped to min y");
  assert.equal(byId.get("low")!.y, 3000, "low clamped to max y");
  assert.deepEqual(byId.get("inside"), { x: 200, y: 200 }, "inside untouched");
});
```

At the top of the file (below the existing imports), add a helper used by this and later tests:

```typescript
function makeSidecar(
  nodes: Array<{ id: string; classes: string; position: { x: number; y: number } }>,
): VisualNotesSidecar {
  return {
    kind: "daily-overview",
    title: "test fixture",
    nodes: nodes.map((node) => ({
      data: { id: node.id, label: node.id },
      classes: node.classes,
      position: node.position,
    })),
    edges: [],
  } as VisualNotesSidecar;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin test:feature`

Expected: the new clamp test fails with `-500 !== -200` (or similar) — `repairNodes` currently passes positions through unchanged.

- [ ] **Step 3: Implement `clampOffCanvas`**

In `plugins/obsidian-plugin/src/layout.ts`, add these constants near the existing layout constants at the top of the file:

```typescript
const SCHEMA_MIN_X = -200;
const SCHEMA_MAX_X = 5000;
const SCHEMA_MIN_Y = -200;
const SCHEMA_MAX_Y = 3000;
```

Add the function (place it just below `repairNodes`):

```typescript
function clampOffCanvas(nodes: VisualNotesNode[]): VisualNotesNode[] {
  return nodes.map((node) => {
    const x = clamp(node.position.x, SCHEMA_MIN_X, SCHEMA_MAX_X);
    const y = clamp(node.position.y, SCHEMA_MIN_Y, SCHEMA_MAX_Y);
    if (x === node.position.x && y === node.position.y) {
      return node;
    }
    return { ...node, position: { x, y } };
  });
}
```

`clamp` already exists in this file (line ~818). Reuse it.

Update `repairNodes` to call clamp:

```typescript
function repairNodes(nodes: VisualNotesNode[]): VisualNotesNode[] {
  return clampOffCanvas(nodes);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin test:feature`

Expected: both repair tests pass; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/dislexicmofo/Repositories/visual-notes-issue-21
git add plugins/obsidian-plugin/test/feature/layout.test.ts plugins/obsidian-plugin/src/layout.ts
git commit -m "feat(obsidian): repair pass clamps off-canvas positions

Adds clampOffCanvas to the repair pipeline. Positions outside the
schema bounds (x∈[-200,5000], y∈[-200,3000]) get clamped to the
nearest visible edge; positions already inside are untouched."
```

---

### Task 5: TDD — resolve collisions with label-sized constants

**Files:**
- Modify: `plugins/obsidian-plugin/test/feature/layout.test.ts`
- Modify: `plugins/obsidian-plugin/src/layout.ts`

- [ ] **Step 1: Add the failing test**

Append to the same `describe` block:

```typescript
it("separates two nodes placed at the same position", () => {
  const sidecar = makeSidecar([
    { id: "a", classes: "system context", position: { x: 300, y: 300 } },
    { id: "b", classes: "system context", position: { x: 300, y: 300 } },
  ]);

  const result = applyDeterministicLayout(sidecar);
  const positions = result.nodes.map((n) => n.position);
  const dx = Math.abs(positions[0].x - positions[1].x);
  const dy = Math.abs(positions[0].y - positions[1].y);

  // After repair, nodes must clear the collision envelope of 140x70.
  assert.ok(
    dx >= 140 || dy >= 70,
    `expected separation >= collision radii but got dx=${dx}, dy=${dy}`,
  );
});

it("preserves first node when separating a colliding pair", () => {
  const sidecar = makeSidecar([
    { id: "anchor", classes: "system context", position: { x: 500, y: 400 } },
    { id: "dupe",   classes: "system context", position: { x: 510, y: 405 } },
  ]);

  const result = applyDeterministicLayout(sidecar);
  const anchor = result.nodes.find((n) => n.data.id === "anchor")!;
  assert.deepEqual(anchor.position, { x: 500, y: 400 }, "anchor untouched");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin test:feature`

Expected: both collision tests fail — `repairNodes` doesn't separate yet.

- [ ] **Step 3: Implement `resolveCollisions` with updated radii**

In `plugins/obsidian-plugin/src/layout.ts`:

1. Replace the existing collision constants:

```typescript
// Before:
const COLLISION_RADIUS_X = 120;
const COLLISION_RADIUS_Y = 95;

// After:
const COLLISION_RADIUS_X = 140;
const COLLISION_RADIUS_Y = 70;
```

2. Add the function (place below `clampOffCanvas`):

```typescript
function resolveCollisions(nodes: VisualNotesNode[]): VisualNotesNode[] {
  const repaired: VisualNotesNode[] = [];

  for (const node of nodes) {
    let position = { ...node.position };

    let attempts = 0;
    while (attempts < 12 && hasCollision(position, repaired)) {
      position = nudgeAway(position, repaired);
      // Clamp after each nudge so we don't push off-canvas.
      position = {
        x: clamp(position.x, SCHEMA_MIN_X, SCHEMA_MAX_X),
        y: clamp(position.y, SCHEMA_MIN_Y, SCHEMA_MAX_Y),
      };
      attempts += 1;
    }

    repaired.push(
      position.x === node.position.x && position.y === node.position.y
        ? node
        : { ...node, position },
    );
  }

  return repaired;
}

function hasCollision(
  position: { x: number; y: number },
  placed: VisualNotesNode[],
): boolean {
  return placed.some(
    (other) =>
      Math.abs(other.position.x - position.x) < COLLISION_RADIUS_X &&
      Math.abs(other.position.y - position.y) < COLLISION_RADIUS_Y,
  );
}

function nudgeAway(
  position: { x: number; y: number },
  placed: VisualNotesNode[],
): { x: number; y: number } {
  // Push along the dominant gap direction so we exit the envelope in one step.
  const colliding = placed.find(
    (other) =>
      Math.abs(other.position.x - position.x) < COLLISION_RADIUS_X &&
      Math.abs(other.position.y - position.y) < COLLISION_RADIUS_Y,
  );
  if (!colliding) {
    return position;
  }

  const dx = position.x - colliding.position.x;
  const dy = position.y - colliding.position.y;

  // Pick the axis with more available room to push along.
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sign = dx >= 0 ? 1 : -1;
    return { x: colliding.position.x + sign * COLLISION_RADIUS_X, y: position.y };
  }
  const sign = dy >= 0 ? 1 : -1;
  return { x: position.x, y: colliding.position.y + sign * COLLISION_RADIUS_Y };
}
```

3. Update `repairNodes`:

```typescript
function repairNodes(nodes: VisualNotesNode[]): VisualNotesNode[] {
  return resolveCollisions(clampOffCanvas(nodes));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin test:feature`

Expected: all four repair tests pass; existing tests still pass; `clamp` symbol may need re-import — if you see an error about `clamp` being unresolved at module scope vs. function-local, ensure both new functions reference the existing in-file `clamp` (no import change needed; it's already in the same file).

- [ ] **Step 5: Commit**

```bash
cd /Users/dislexicmofo/Repositories/visual-notes-issue-21
git add plugins/obsidian-plugin/test/feature/layout.test.ts plugins/obsidian-plugin/src/layout.ts
git commit -m "feat(obsidian): repair pass separates colliding nodes

Adds resolveCollisions to the repair pipeline. Updates COLLISION_RADIUS
constants (140x70) for label-sized nodes from #21. The first node of a
colliding pair stays put; subsequent nodes get nudged along the dominant
gap axis until they clear the envelope (bounded to 12 attempts)."
```

---

### Task 6: TDD — assign positions for nodes missing them

**Files:**
- Modify: `plugins/obsidian-plugin/test/feature/layout.test.ts`
- Modify: `plugins/obsidian-plugin/src/layout.ts`

- [ ] **Step 1: Add the failing test**

Append to the same `describe` block:

```typescript
it("assigns a visible position to a node with missing coordinates", () => {
  const sidecar = makeSidecar([
    { id: "placed-a", classes: "system context", position: { x: 200, y: 200 } },
    { id: "placed-b", classes: "system context", position: { x: 600, y: 200 } },
    { id: "ghost",    classes: "system context", position: { x: 0,   y: 0   } },
  ]);

  const result = applyDeterministicLayout(sidecar);
  const ghost = result.nodes.find((n) => n.data.id === "ghost")!;

  assert.ok(
    ghost.position.x >= SCHEMA_MIN_X_BOUND && ghost.position.x <= SCHEMA_MAX_X_BOUND,
    `ghost x ${ghost.position.x} should be inside schema bounds`,
  );
  assert.ok(
    ghost.position.y >= SCHEMA_MIN_Y_BOUND && ghost.position.y <= SCHEMA_MAX_Y_BOUND,
    `ghost y ${ghost.position.y} should be inside schema bounds`,
  );
  // It must not still be at (0,0): assignment moved it.
  assert.ok(
    !(ghost.position.x === 0 && ghost.position.y === 0),
    "ghost was assigned a non-zero position",
  );
});
```

At the top of the test file (below the existing imports/helper), add:

```typescript
const SCHEMA_MIN_X_BOUND = -200;
const SCHEMA_MAX_X_BOUND = 5000;
const SCHEMA_MIN_Y_BOUND = -200;
const SCHEMA_MAX_Y_BOUND = 3000;
```

(These mirror the source constants so the test isn't coupled to source export shape.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin test:feature`

Expected: the new test fails — `ghost` remains at `(0, 0)`.

- [ ] **Step 3: Implement `assignMissingPositions`**

In `plugins/obsidian-plugin/src/layout.ts`, add the function (place it above `clampOffCanvas`):

```typescript
function assignMissingPositions(nodes: VisualNotesNode[]): VisualNotesNode[] {
  const placed = nodes.filter((node) => !isMissingPosition(node.position));
  const missing = nodes.filter((node) => isMissingPosition(node.position));

  if (missing.length === 0) {
    return nodes;
  }

  const anchor = centroidOrDefault(placed.map((n) => n.position));
  let cursor = 0;

  const assigned = new Map<string, { x: number; y: number }>();
  for (const node of missing) {
    const slot = findFreeSlot(anchor, cursor, [...placed, ...nodesFromAssigned(assigned, nodes)]);
    assigned.set(node.data.id, slot);
    cursor += 1;
  }

  return nodes.map((node) => {
    const slot = assigned.get(node.data.id);
    return slot ? { ...node, position: slot } : node;
  });
}

function isMissingPosition(position: { x: number; y: number }): boolean {
  return position.x === 0 && position.y === 0;
}

function centroidOrDefault(positions: { x: number; y: number }[]): { x: number; y: number } {
  if (positions.length === 0) {
    return { x: 400, y: 300 };
  }
  return calculateCentroid(positions);
}

function findFreeSlot(
  anchor: { x: number; y: number },
  cursor: number,
  placed: VisualNotesNode[],
): { x: number; y: number } {
  // Spiral outwards from the anchor in COLLISION_RADIUS_X increments
  // until we find a slot the collision pass would accept.
  const radii = [0, 1, 2, 3, 4, 5];
  for (const radius of radii) {
    const candidates = ringCandidates(anchor, radius);
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[(cursor + i) % candidates.length];
      const clamped = {
        x: clamp(Math.round(candidate.x), SCHEMA_MIN_X, SCHEMA_MAX_X),
        y: clamp(Math.round(candidate.y), SCHEMA_MIN_Y, SCHEMA_MAX_Y),
      };
      if (!hasCollision(clamped, placed)) {
        return clamped;
      }
    }
  }
  // Last-resort fallback: drop on the anchor (collisions later resolved by resolveCollisions).
  return {
    x: clamp(Math.round(anchor.x), SCHEMA_MIN_X, SCHEMA_MAX_X),
    y: clamp(Math.round(anchor.y), SCHEMA_MIN_Y, SCHEMA_MAX_Y),
  };
}

function ringCandidates(
  anchor: { x: number; y: number },
  radius: number,
): { x: number; y: number }[] {
  if (radius === 0) {
    return [{ x: anchor.x, y: anchor.y }];
  }
  const stepX = COLLISION_RADIUS_X;
  const stepY = COLLISION_RADIUS_Y;
  const candidates: { x: number; y: number }[] = [];
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
        continue;
      }
      candidates.push({ x: anchor.x + dx * stepX, y: anchor.y + dy * stepY });
    }
  }
  return candidates;
}

function nodesFromAssigned(
  assigned: Map<string, { x: number; y: number }>,
  originals: VisualNotesNode[],
): VisualNotesNode[] {
  // Wrap assigned coordinates as VisualNotesNode-shaped objects so hasCollision can use them.
  return Array.from(assigned.entries()).map(([id, position]) => {
    const original = originals.find((node) => node.data.id === id);
    return original ? { ...original, position } : ({ data: { id, label: id }, classes: "", position } as VisualNotesNode);
  });
}
```

Update `repairNodes`:

```typescript
function repairNodes(nodes: VisualNotesNode[]): VisualNotesNode[] {
  return resolveCollisions(clampOffCanvas(assignMissingPositions(nodes)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin test:feature`

Expected: all repair tests pass; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/dislexicmofo/Repositories/visual-notes-issue-21
git add plugins/obsidian-plugin/test/feature/layout.test.ts plugins/obsidian-plugin/src/layout.ts
git commit -m "feat(obsidian): repair pass assigns positions for missing nodes

Adds assignMissingPositions to the repair pipeline. Nodes with (0,0)
positions are placed at the nearest free spot near the centroid of
placed nodes (spiral search in collision-radius increments). Falls
back to anchor coordinates if every ring slot is occupied — collisions
get resolved later in the pipeline."
```

---

### Task 7: TDD — respect `_pinned`

**Files:**
- Modify: `plugins/obsidian-plugin/test/feature/layout.test.ts`

- [ ] **Step 1: Add the failing test**

Append to the same `describe` block:

```typescript
it("returns pinned sidecars unchanged even when positions look broken", () => {
  const pinned = {
    ...makeSidecar([
      { id: "off-canvas", classes: "system context", position: { x: -9999, y: 9999 } },
      { id: "collider-a", classes: "system context", position: { x: 100, y: 100 } },
      { id: "collider-b", classes: "system context", position: { x: 100, y: 100 } },
    ]),
    _pinned: true,
  } as VisualNotesSidecar;

  const result = applyDeterministicLayout(pinned);

  assert.equal(result, pinned, "pinned sidecar returned by identity");
});
```

- [ ] **Step 2: Run test to verify it passes immediately**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin test:feature`

Expected: this test **already passes**, because Task 3 preserved the `if (sidecar._pinned) return sidecar;` short-circuit. The reason for writing it as a TDD step is to lock the invariant in place so any future refactor that loses the short-circuit is caught immediately.

If the test does NOT pass: a previous task accidentally removed the `_pinned` guard from `applyDeterministicLayout`. Restore the early return at the top:

```typescript
export function applyDeterministicLayout(sidecar: VisualNotesSidecar): VisualNotesSidecar {
  if (sidecar._pinned) {
    return sidecar;
  }
  return { ...sidecar, nodes: repairNodes(sidecar.nodes) };
}
```

- [ ] **Step 3: No implementation change needed**

(Test was added as a regression guard.)

- [ ] **Step 4: Run all feature tests to confirm green**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin test:feature`

Expected: all repair tests + existing tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/dislexicmofo/Repositories/visual-notes-issue-21
git add plugins/obsidian-plugin/test/feature/layout.test.ts
git commit -m "test(obsidian): lock pinned-sidecar short-circuit with regression test

Adds a guard test asserting applyDeterministicLayout returns pinned
sidecars by identity even when their positions would otherwise trigger
clamp/collision/missing-position repair."
```

---

### Task 8: Delete dead grid-layout code

**Files:**
- Modify: `plugins/obsidian-plugin/src/layout.ts`

- [ ] **Step 1: Identify dead code**

Open `plugins/obsidian-plugin/src/layout.ts`. The following functions are no longer called by `applyDeterministicLayout` (now uses `repairNodes`) and have no other consumers:

```
layoutNodes
layoutFlatBoard
optimizeFlatBoardOrder
improveFlatBoardOrder
flatBoardCost
buildVisualComponents
findSingletonStoryTarget
layoutComponent
orderComponentNodes
isConnectedToAny
columnCountForComponent
selectAnchor
normalizePositions
packComponents
findComponents
sortNodes
componentScore
scoreNode
typeWeight
statusWeight
minNodeIndex
maxNodeIndex
parseNodeClasses
isNodeType
isNodeStatus
find         (union-find helper)
union        (union-find helper)
```

**Keep** the following — still used by `calculateLayoutMetrics` or by the new repair helpers:

```
calculateLayoutMetrics    (exported, used by validate:layout)
emptyMetrics
getPrimaryEdges
calculateDegree
buildInfoById               (used by calculateLayoutMetrics)
calculateCentroid           (used by assignMissingPositions + metrics)
calculateProximityStats
calculateEdgeLengths
calculateComponentStats     (uses buildVisualComponents — keep or refactor; see step 2)
countEdgeCrossings
countCrossingsForPositions
edgeLengthCost
edgesShareEndpoint
segmentsCross
orientation
boundsForPositions
distance
average
clamp
clampPosition
```

**Wait** — `calculateComponentStats` calls `buildVisualComponents` which would be deleted. Decide one of:

- (a) Keep `buildVisualComponents` + its dependencies (`findComponents`, `sortNodes`, `componentScore`, `scoreNode`, `typeWeight`, `statusWeight`, `minNodeIndex`, `maxNodeIndex`, `parseNodeClasses`, `isNodeType`, `isNodeStatus`, `find`, `union`, `findSingletonStoryTarget`) — keeps `calculateComponentStats` working.
- (b) Drop `calculateComponentStats` from `calculateLayoutMetrics` output. The `maxComponentWidth` / `maxComponentHeight` fields become 0 or get removed.

Choose (a) for this PR — `calculateLayoutMetrics` is a contract surface (used by `validate:layout`); changing its output shape is a bigger blast radius than keeping ~120 unused-by-runtime lines. Mark them with a short top-of-block comment instead.

- [ ] **Step 2: Delete the truly-dead functions**

Delete from `plugins/obsidian-plugin/src/layout.ts`:

```
layoutNodes
layoutFlatBoard
optimizeFlatBoardOrder
improveFlatBoardOrder
flatBoardCost
layoutComponent
orderComponentNodes
isConnectedToAny
columnCountForComponent
selectAnchor
normalizePositions
packComponents
```

Also delete the constants only used by those functions:

```
CANVAS_START_X
CANVAS_START_Y
COMPONENT_GAP_X
COMPONENT_GAP_Y
COMPONENT_ROW_WIDTH
NODE_GAP_X
NODE_GAP_Y
FLAT_BOARD_MAX_NODES
FLAT_BOARD_TARGET_ROWS
FLAT_BOARD_MAX_COLUMNS
```

**Keep** (still referenced by `calculateLayoutMetrics`):

```
READABLE_CARD_WIDTH
READABLE_CARD_HEIGHT
FIT_PADDING_X
FIT_PADDING_Y
NODE_FONT_SIZE
VISIBLE_MIN_X
MAX_X
MAX_Y
buildVisualComponents      (keep for calculateComponentStats)
findSingletonStoryTarget
findComponents
sortNodes
componentScore
scoreNode
typeWeight
statusWeight
minNodeIndex
maxNodeIndex
parseNodeClasses
isNodeType
isNodeStatus
find
union
ComponentLayout (type)
```

Add a comment above `buildVisualComponents`:

```typescript
// Retained for calculateLayoutMetrics' component stats. The repair pass
// added in #21 does not lay out by component; this function is only
// reached through metrics calculation.
```

- [ ] **Step 3: Run typecheck and tests**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin typecheck && pnpm --filter @visual-notes/obsidian-plugin test:feature`

Expected: both succeed. If TypeScript complains about unused symbols, either:
- Confirm the symbol genuinely has no consumers (`grep -r "<symbolName>" plugins/obsidian-plugin/src plugins/obsidian-plugin/test plugins/obsidian-plugin/scripts`) and delete it
- Or restore it if it has a consumer

- [ ] **Step 4: Run `validate:layout` to confirm metrics still work**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin validate:layout`

Expected: the script may **fail** the quality gates — the fixtures inside it are intentionally-bad inputs that previously got fully re-laid out, and now only get repaired. Don't fix the script in this task; Task 9 handles it. Note the failure(s) and move on.

If the script passes: the existing fixtures happened to be repair-friendly. Lucky.

- [ ] **Step 5: Commit**

```bash
cd /Users/dislexicmofo/Repositories/visual-notes-issue-21
git add plugins/obsidian-plugin/src/layout.ts
git commit -m "refactor(obsidian): drop dead grid-layout code (#21)

applyDeterministicLayout is now a repair pass; the topology grid
layout it replaced is removed. ~500 lines deleted: layoutNodes,
layoutFlatBoard, packComponents, optimizeFlatBoardOrder, and
their helpers + private constants. buildVisualComponents and its
union-find helpers stay because calculateLayoutMetrics still uses
them for component stats (preserves the metrics output shape)."
```

---

### Task 9: Update `layout-metrics.mjs` fixtures for repair-pass semantics

**Files:**
- Modify: `plugins/obsidian-plugin/scripts/layout-metrics.mjs`

- [ ] **Step 1: Understand the new contract**

The script currently runs `applyDeterministicLayout` against fixtures and asserts the output meets quality gates (`maxClosePairs: 0`, `maxEdgeCrossings: 8`, etc.). Old fixtures were intentionally-bad inputs that the full grid layout fixed. The new contract: fixtures are realistic LLM-style inputs and the metrics validate that repair preserves quality.

- [ ] **Step 2: Replace fixtures with narrative-positioned data**

Open `plugins/obsidian-plugin/scripts/layout-metrics.mjs`. Replace the `fixtures` array with two fixtures sourced from real data:

```javascript
import { readFile as readFile2 } from "node:fs/promises";

const narrativeOverviewPath = new URL(
  "../test/fixtures/narrative-positioned-overview.json",
  import.meta.url,
);
const narrativeSidecar = JSON.parse(await readFile2(narrativeOverviewPath, "utf8"));

const collisionRepairFixture = {
  kind: "daily-overview",
  title: "Collision repair fixture",
  nodes: [
    // Three nodes intentionally placed within 140x70 of each other
    // — repair pass must separate them while preserving the first.
    node("anchor", "Anchor\nnode", "system active", 400, 300),
    node("dupe-1", "Dupe\none",   "system context", 410, 305),
    node("dupe-2", "Dupe\ntwo",   "system context", 420, 310),
    // A well-placed outlier so the overall layout still has spread.
    node("far",    "Far\nnode",   "system context", 1200, 600),
  ],
  edges: [
    edge("anchor", "dupe-1", "near"),
    edge("anchor", "dupe-2", "near"),
    edge("anchor", "far", "spans to"),
  ],
};

const fixtures = [
  { name: "Narrative-positioned overview (preserved by repair)", sidecar: narrativeSidecar },
  { name: "Collision repair separates colliding triple", sidecar: collisionRepairFixture },
];
```

(The `node` and `edge` helper functions further down the file are still used.)

- [ ] **Step 3: Tune the quality gate for the new contract**

The narrative fixture has higher edge counts and a different spread than the old hand-crafted ones. Adjust the `qualityGate` object to match real-world data:

```javascript
const qualityGate = {
  maxWidth: 1500,            // narrative fixtures span wider
  maxHeight: 800,
  minCardFitScale: 0.6,
  minNodeDistance: 90,        // collision radius - small slack
  maxClosePairs: 0,
  maxEdgeCrossings: 12,       // narrative layouts can have crossings; quality is acceptable
  maxOutlierRatio: 3.5,
  maxPrimaryEdgeLength: 600,
  maxWeakEdgeLength: 1000,
  maxWeakEdgeLengthBudget: 2400,
  maxComponentWidth: 1500,
  maxComponentHeight: 800,
  minEstimatedDefaultNodeFontPx: 10,
};
```

- [ ] **Step 4: Run `validate:layout` to confirm passing**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin validate:layout`

Expected: both fixtures pass. If the collision-repair fixture fails because the repaired positions still violate `minNodeDistance`, raise the collision constants in `src/layout.ts` slightly OR tune `minNodeDistance` to match what the repair guarantees (90 is a safe floor given 70-radius Y and 140-radius X).

- [ ] **Step 5: Commit**

```bash
cd /Users/dislexicmofo/Repositories/visual-notes-issue-21
git add plugins/obsidian-plugin/scripts/layout-metrics.mjs
git commit -m "test(obsidian): retarget layout-metrics fixtures for repair pass (#21)

Old fixtures were intentionally-bad inputs that the full grid layout
fixed. Repair-pass behavior preserves good positions, so fixtures
now use:
  1. A real narrative-positioned overview (must pass through unchanged)
  2. A synthetic collision-repair input (must separate to >= radii)
Quality-gate thresholds widened to match realistic-data ranges
instead of hand-crafted ones."
```

---

## Phase B — Styling parity

Independent of Phase A; could happen in parallel. Sequenced after A here so the manual QA at the end exercises both changes together.

### Task 10: Node style block — label-sized + smaller font

**Files:**
- Modify: `plugins/obsidian-plugin/src/renderer.ts` (function `createStyle`, node selector)

- [ ] **Step 1: Locate the node style block**

Open `plugins/obsidian-plugin/src/renderer.ts`. Find the `createStyle()` method and the `{ selector: "node", style: { ... } }` entry (around lines 254-275).

- [ ] **Step 2: Replace the node style block**

Replace the existing node style entry with:

```typescript
{
  selector: "node",
  style: {
    "background-color": theme.contextBg,
    "border-color": theme.border,
    "border-width": 2,
    color: theme.nodeText,
    label: "data(displayLabel)",
    "font-family": "sans-serif",
    "font-size": 11,
    "font-weight": 500,
    "text-valign": "center",
    "text-halign": "center",
    "text-wrap": "wrap",
    "text-max-width": "100px",
    width: "label",
    height: "label",
    padding: "12px",
    shape: "round-rectangle",
    "z-index": 10,
    "z-index-compare": "manual",
  },
},
```

The diff vs. before: `font-size 13→11`, `font-weight 600→500`, `width 118→"label"`, `height 54→"label"`.

- [ ] **Step 3: Typecheck**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin typecheck`

Expected: passes. Cytoscape's TypeScript types accept `"label"` as a valid value for `width` and `height` (it's a documented literal in their style system).

If you see a TypeScript error, the cytoscape style cast at the end of `createStyle` (`return stylesheet as cytoscape.StylesheetJson`) already widens the type. No additional cast should be needed.

- [ ] **Step 4: Run feature tests**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin test:feature`

Expected: all pass. (No renderer tests yet check the new values — that's added in Task 13 alongside hover testing.)

- [ ] **Step 5: Commit**

```bash
cd /Users/dislexicmofo/Repositories/visual-notes-issue-21
git add plugins/obsidian-plugin/src/renderer.ts
git commit -m "feat(obsidian): label-sized nodes with calmer font (#21)

Switches node width/height to 'label' so nodes size to their text
(matches legacy hook). Drops font from 13/600 to 11/500 for legacy
density. text-max-width 100px caps single-line sprawl."
```

---

### Task 11: Edge style block — quieter labels + width 4

**Files:**
- Modify: `plugins/obsidian-plugin/src/renderer.ts` (function `createStyle`, edge selectors)

- [ ] **Step 1: Replace the base edge style block**

In `createStyle()`, replace the `{ selector: "edge", style: { ... } }` entry (around lines 296-316) with:

```typescript
{
  selector: "edge",
  style: {
    width: 4,
    "line-color": theme.edge,
    "target-arrow-color": theme.edge,
    "target-arrow-shape": "triangle",
    "arrow-scale": 1.1,
    "curve-style": "bezier",
    color: theme.muted,
    label: "data(displayLabel)",
    "font-size": 11,
    "font-family": "sans-serif",
    "font-weight": "normal",
    "text-background-color": theme.background,
    "text-background-opacity": 0.92,
    "text-background-padding": "4px",
    "text-rotation": "none",
    "z-index": 1,
    "z-index-compare": "manual",
  },
},
```

Diff vs. before: `width 2→4`, `arrow-scale 0.8→1.1`, `color theme.nodeText→theme.muted`, `font-size 14→11`, `font-weight 700→normal`, `text-background-opacity 0.95→0.92`, `text-background-padding "5px"→"4px"`.

`theme.muted` was already defined at the top of `createStyle()`. If `color` ends up too faint, change to `theme.nodeText`. Run manual QA in Phase D to decide.

- [ ] **Step 2: Replace the strong-edge block**

Replace `{ selector: "edge.strong-edge", ... }` (around lines 318-325) with:

```typescript
{
  selector: "edge.strong-edge",
  style: {
    width: 5,
    "line-color": theme.strong,
    "target-arrow-color": theme.strong,
  },
},
```

Diff: `width 3→5`.

- [ ] **Step 3: Replace the weak-edge block**

Replace `{ selector: "edge.weak-edge", ... }` (around lines 326-334) with:

```typescript
{
  selector: "edge.weak-edge",
  style: {
    width: 3,
    "line-style": "dashed",
    "line-color": theme.weak,
    "target-arrow-color": theme.weak,
  },
},
```

Diff: `width 1→3`.

- [ ] **Step 4: Typecheck + feature tests**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin typecheck && pnpm --filter @visual-notes/obsidian-plugin test:feature`

Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
cd /Users/dislexicmofo/Repositories/visual-notes-issue-21
git add plugins/obsidian-plugin/src/renderer.ts
git commit -m "feat(obsidian): calmer edge labels and legacy edge widths (#21)

Drops edge labels from 14/700 to 11/normal with 92% opacity bg
(matches legacy density). Bumps base edge to width 4, strong to 5,
weak to 3 to match the legacy template's edge weights. Arrow-scale
1.1 for clearer arrowheads against thicker edges."
```

---

### Task 12: Cytoscape init — wheelSensitivity polish

**Files:**
- Modify: `plugins/obsidian-plugin/src/renderer.ts` (function `renderGraph`)

- [ ] **Step 1: Locate the cytoscape init**

In `plugins/obsidian-plugin/src/renderer.ts`, find the `this.cy = cytoscape({ ... })` block inside `renderGraph()` (around lines 120-127).

- [ ] **Step 2: Add wheelSensitivity**

Modify the init to include `wheelSensitivity: 0.3`:

```typescript
this.cy = cytoscape({
  container: graphEl,
  elements,
  layout: { name: "preset", fit: false },
  style: this.createStyle(),
  minZoom: 0.1,
  maxZoom: 3,
  wheelSensitivity: 0.3,
});
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin typecheck`

Expected: passes.

- [ ] **Step 4: Run feature tests**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin test:feature`

Expected: passes.

- [ ] **Step 5: Commit**

```bash
cd /Users/dislexicmofo/Repositories/visual-notes-issue-21
git add plugins/obsidian-plugin/src/renderer.ts
git commit -m "feat(obsidian): smoother zoom (wheelSensitivity 0.3) (#21)

Matches the legacy template's zoom feel."
```

---

### Task 13: Hover edge highlighting — test + implementation

**Files:**
- Modify: `plugins/obsidian-plugin/src/renderer.ts` (function `renderGraph` + new method `bindHoverInteractions`)
- Modify: `plugins/obsidian-plugin/scripts/renderer-contract.mjs` (assertions for hover handler presence)

- [ ] **Step 1: Add an assertion to `renderer-contract.mjs` requiring the hover handler**

`renderer-contract.mjs` does substring matching against `renderer.ts`. Add to the `evaluateRendererSourceContract` function (look for the closing `return contractFailures;` and add before it):

```javascript
if (!source.includes("bindHoverInteractions") || !source.includes('cy.on("mouseover"')) {
  contractFailures.push("renderer must bind hover handlers for edge highlighting");
}
if (!source.includes("--interactive-accent")) {
  contractFailures.push("renderer must use Obsidian's --interactive-accent for hover color");
}
```

- [ ] **Step 2: Run `validate:renderer` to verify the new assertion fails**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin validate:renderer`

Expected: fails with "renderer must bind hover handlers for edge highlighting" — `bindHoverInteractions` doesn't exist yet.

- [ ] **Step 3: Add `bindHoverInteractions` method and call it from `renderGraph`**

In `plugins/obsidian-plugin/src/renderer.ts`, add a new private method to the `VisualNotesRenderChild` class (place after `createStyle`):

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

Then in `renderGraph()`, call it after the cytoscape constructor and before `observeGraphSize`:

```typescript
this.cy = cytoscape({
  container: graphEl,
  elements,
  layout: { name: "preset", fit: false },
  style: this.createStyle(),
  minZoom: 0.1,
  maxZoom: 3,
  wheelSensitivity: 0.3,
});
this.bindHoverInteractions();
this.observeGraphSize(graphEl);
```

- [ ] **Step 4: Run `validate:renderer` to confirm passing**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin validate:renderer`

Expected: passes. If it still fails, check the assertion strings in `renderer-contract.mjs` against the actual symbol names — exact substring match is required.

- [ ] **Step 5: Typecheck and test**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin typecheck && pnpm --filter @visual-notes/obsidian-plugin test:feature`

Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
cd /Users/dislexicmofo/Repositories/visual-notes-issue-21
git add plugins/obsidian-plugin/src/renderer.ts plugins/obsidian-plugin/scripts/renderer-contract.mjs
git commit -m "feat(obsidian): hover edge highlighting (#21)

Mouseover any node now thickens its border and recolors connected
edges to Obsidian's --interactive-accent (purpose-built theme var,
auto-adapts to light/dark/custom themes). Mouseout strips inline
styles so class-driven (strong/weak) colors auto-restore.

Adds matching renderer-contract assertions so the binding can't be
silently removed."
```

---

### Task 14: Update `renderer-contract.mjs` for new styling values

**Files:**
- Modify: `plugins/obsidian-plugin/scripts/renderer-contract.mjs`

- [ ] **Step 1: Locate the stale assertions**

Open `plugins/obsidian-plugin/scripts/renderer-contract.mjs` and find the `evaluateRendererSourceContract` function. It contains:

```javascript
if (
  !source.includes('"font-size": 14') ||
  !source.includes('"font-weight": 700') ||
  !source.includes('"arrow-scale": 0.8')
) {
  contractFailures.push("renderer must keep readable 14px relationship labels and arrow scale");
}
if (!source.includes('"text-background-opacity": 0.95') || !source.includes('"text-background-padding": "5px"')) {
  contractFailures.push("edge labels must keep a readable background halo");
}
```

These now fail because Tasks 10-11 changed every one of those values.

- [ ] **Step 2: Run validate:renderer to see the current failures**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin validate:renderer`

Expected: failures complaining about font-size 14, font-weight 700, arrow-scale 0.8, text-background-opacity 0.95, text-background-padding 5px.

- [ ] **Step 3: Replace the assertions to match new values**

Replace the two failing blocks with:

```javascript
if (
  !source.includes('"font-size": 11') ||
  !source.includes('"font-weight": "normal"') ||
  !source.includes('"arrow-scale": 1.1')
) {
  contractFailures.push("renderer must keep 11px normal-weight edge labels and 1.1 arrow scale (#21)");
}
if (!source.includes('"text-background-opacity": 0.92') || !source.includes('"text-background-padding": "4px"')) {
  contractFailures.push("edge labels must keep a 92% opacity halo with 4px padding (#21)");
}
if (!source.includes('width: "label"') || !source.includes('height: "label"')) {
  contractFailures.push("nodes must be label-sized (width/height: 'label') (#21)");
}
if (!source.includes("wheelSensitivity: 0.3")) {
  contractFailures.push("renderer must keep wheelSensitivity 0.3 for smooth zoom (#21)");
}
```

- [ ] **Step 4: Run validate:renderer to confirm passing**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin validate:renderer`

Expected: all assertions pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/dislexicmofo/Repositories/visual-notes-issue-21
git add plugins/obsidian-plugin/scripts/renderer-contract.mjs
git commit -m "test(obsidian): update renderer contract to match #21 styling

Refreshes the substring-based renderer contract assertions to the
new values: 11px/normal edge labels, 1.1 arrow scale, 92% opacity
text-background-padding, label-sized nodes, wheelSensitivity 0.3.
Adds two new assertions for label-sized nodes and wheelSensitivity
that the original contract didn't cover."
```

---

## Phase C — Documentation

### Task 15: Update `docs/design.md`

**Files:**
- Modify: `docs/design.md`

- [ ] **Step 1: Locate the "Layout strategy" section**

Open `docs/design.md`. Find the section starting with `### Layout strategy` (around line 79).

- [ ] **Step 2: Replace the body of the Layout strategy section**

Replace the section body (from "v0.1 uses LLM-provided..." through the "Design tasks:" list, lines ~80-104) with:

```markdown
### Layout strategy

**Resolved in #21:** the renderer trusts LLM-provided positions. The
deterministic layout was retired in favor of a repair pass that fixes
specific defects (missing coordinates, off-canvas positions,
collisions <140x70) without reorganizing what isn't broken. This
preserves the narrative semantics Claude already encodes (cluster
columns + status tiers from the extraction prompt) without paying
twice for layout logic in TypeScript.

Background:

- v0.1 used LLM positions with Cytoscape's `preset` layout, then
  deterministically normalized them via component grid packing.
- The grid normalization erased the narrative awareness Claude
  produced (hub-at-top-center, status-tier Y banding, cluster
  columns based on the day's threads), replacing it with a generic
  topology grid.
- #21 stops the normalization step. `applyDeterministicLayout` is
  now a thin repair pipeline (assignMissing → clampOffCanvas →
  resolveCollisions). `calculateLayoutMetrics` is kept exported for
  potential future quality-gate work.
- Pinned sidecars (`_pinned: true`) remain authoritative and skip
  the repair pass entirely.
- Existing on-disk sidecars retain their previously-grid'd positions
  until they're force-regenerated. A future retroactive re-layout
  migration is captured as a follow-up issue.
```

- [ ] **Step 3: Update the "Open decisions" table**

Find the open decisions table at the bottom of `docs/design.md`. Update the `Layout algorithm` row:

```markdown
| Layout algorithm | ✅ Trust LLM positions + repair pass (decided in #21) | — |
```

- [ ] **Step 4: Add a new section "Legacy hook artifacts vs. plugin renderer"**

Append (before `## Reference links`):

```markdown
### Legacy hook artifacts vs. plugin renderer

Several work-vault folders (notably `0 Profisee/...`) contain static
`*-overview.html` and `whiteboard.html` files alongside their
`*-overview.json` sidecars. These HTMLs were produced by a prior
agent-curated workflow:

1. An agent/skill authored a sidecar JSON with curated nodes,
   edges, classes, and positions.
2. A PostToolUse hook ran `~/ai/skills/visual-notes/scripts/regenerate.py`,
   which spliced the sidecar into a cached
   `cytoscape-template.html` and wrote a sibling HTML.
3. The daily note linked the HTML via iframe.

This path is not the future direction. The Obsidian plugin renders
sidecars inline from the same JSON contract, eliminating the
static HTML middle-step and removing the dependency on agent
curation for daily notes. The historical HTMLs remain on disk as
reference artifacts but are not regenerated.

If you're touching anything in `~/ai/skills/visual-notes/scripts/`,
you're working on the legacy path. If you're touching
`plugins/obsidian-plugin/src/`, you're working on the future path.
```

- [ ] **Step 5: Commit**

```bash
cd /Users/dislexicmofo/Repositories/visual-notes-issue-21
git add docs/design.md
git commit -m "docs: resolve layout-strategy open decision; legacy vs plugin section (#21)

Records the #21 architectural decision: trust LLM positions, demote
deterministic layout to a repair pass. Updates the open-decisions
table. Adds a section distinguishing legacy hook-rendered HTMLs from
the plugin renderer (acceptance criterion 4 of #21)."
```

---

### Task 16: Update top-level and plugin READMEs

**Files:**
- Modify: `README.md`
- Modify: `plugins/obsidian-plugin/README.md`

- [ ] **Step 1: Add a section to the top-level `README.md`**

Open `README.md`. Find an appropriate insertion point (after the high-level overview, before installation instructions — typically around the section that describes what the plugin does vs. what the Claude Code plugin does).

Add a short paragraph:

```markdown
### Legacy artifacts in older vaults

If you have a vault that already contains `*-overview.html` files
alongside their `*-overview.json` sidecars (typically under work
folders), those HTMLs were produced by a previous agent-curated
workflow and are not regenerated by the Obsidian plugin. The plugin
renders the same JSON inline; the legacy HTMLs are reference
artifacts only. See [docs/design.md — Legacy hook artifacts vs.
plugin renderer](docs/design.md#legacy-hook-artifacts-vs-plugin-renderer)
for the full story.
```

- [ ] **Step 2: Add the same explainer to `plugins/obsidian-plugin/README.md`**

Open `plugins/obsidian-plugin/README.md`. Add a section near the bottom (before any contribution or build instructions):

```markdown
### Why my old `*-overview.html` files aren't being updated

The plugin reads `*-overview.json` sidecars and renders them inline
in Obsidian. The static HTML files some older vaults contain were
produced by a legacy agent-curated workflow that is no longer the
target architecture. The HTMLs remain on disk as reference but the
plugin doesn't regenerate or read them. See
[the design notes](../../docs/design.md#legacy-hook-artifacts-vs-plugin-renderer)
for context.
```

- [ ] **Step 3: Commit**

```bash
cd /Users/dislexicmofo/Repositories/visual-notes-issue-21
git add README.md plugins/obsidian-plugin/README.md
git commit -m "docs(readme): point users to legacy vs plugin explainer (#21)

Adds short paragraphs in both top-level and plugin READMEs pointing
to docs/design.md's new 'Legacy hook artifacts vs. plugin renderer'
section. Satisfies acceptance criterion 4 of #21 for users who
arrive at the repo via README rather than design.md."
```

---

## Phase D — Manual QA and PR-ready check

### Task 17: Manual verification in Obsidian and final wrap-up

**Files:**
- None modified by default; capture any tweaks discovered during QA

- [ ] **Step 1: Run the full validate suite**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin validate && pnpm --filter @visual-notes/obsidian-plugin test:feature`

Expected: typecheck + validate:layout + validate:renderer + all feature tests pass.

- [ ] **Step 2: Build the plugin**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && pnpm --filter @visual-notes/obsidian-plugin build`

Expected: produces `plugins/obsidian-plugin/main.js` (or similar build artifact). No errors.

- [ ] **Step 3: Install the dev build into a test vault**

You have two options:

(a) **BRAT into your real vault** — if the WIP `main.js` is comfortable to replace temporarily.

(b) **Symlink approach** for a clean test:

```bash
# From a test vault's .obsidian/plugins directory
ln -s /Users/dislexicmofo/Repositories/visual-notes-issue-21/plugins/obsidian-plugin visual-notes-issue-21
```

Enable the plugin from Obsidian's Community plugins settings.

- [ ] **Step 4: Force-regenerate today's overview**

In Obsidian, open `0 Daily ADHD Brain Logs/20260518.md` (or whichever daily note's `*-overview.json` you want to refresh). Use the command palette: `Visual Notes: Force regenerate sidecar`.

Wait for the extraction to finish (status bar shows count).

- [ ] **Step 5: Visual verification checklist**

Open the daily note and confirm the inline graph shows:

- [ ] Nodes size to their labels (long labels grow; short labels are compact)
- [ ] Edge labels read calmly (11px, normal weight, not shouting over the lines)
- [ ] Hover any node — its connected edges turn accent-blue and thicken
- [ ] Smooth zoom with mouse wheel (not jumpy)
- [ ] Header + legend still visible at the top
- [ ] Theme: switch Obsidian to light mode and back — graph still readable in both

Compare visually against `docs/superpowers/specs/samples/2026-05-18-issue-21-proposed-style.html` (open in a browser). They will not be identical — the proposed sample uses hand-authored narrative positions while a real LLM extraction may differ — but the *styling* should match: label-sized nodes, calm edge labels, hover highlight working.

- [ ] **Step 6: Pinned sidecar check**

Pick any sidecar in your vault. Set `_pinned: true` manually in the JSON. Move one node off-canvas (e.g., set `x: -9999`). Reload the daily note in Obsidian. Confirm the node renders at its (broken) pinned position — the repair pass did NOT touch it.

Restore `_pinned: false` and the off-canvas node afterwards.

- [ ] **Step 7: Existing grid'd sidecar check**

Pick an existing daily-overview sidecar from before this PR. Open the note in Obsidian without force-regenerating. Confirm the visual still renders without errors — the grid'd positions still display (just with the new styling). This validates that the repair pass doesn't corrupt pre-existing data.

- [ ] **Step 8: Commit any small adjustments**

If anything in Steps 5-7 surfaced a needed tweak (e.g., edge color too faint, hover thickness too aggressive), make the fix and commit:

```bash
cd /Users/dislexicmofo/Repositories/visual-notes-issue-21
git add <changed file(s)>
git commit -m "fix(obsidian): <specific QA adjustment> (#21)"
```

If no adjustments were needed, no commit. Skip this step.

- [ ] **Step 9: Final summary**

Run: `cd /Users/dislexicmofo/Repositories/visual-notes-issue-21 && git log --oneline main..feat/issue-21-visual-fidelity`

Expected: ~14-16 commits forming a clean linear history. Each is a self-contained change a reviewer can read in isolation.

Branch is ready for `gh pr create` against `main`. PR body should reference issue #21 and link to the spec + plan documents.

---

## Self-review checklist

After completing all tasks, before opening a PR:

- [ ] All four acceptance criteria from the issue verified
- [ ] `pnpm validate` passes (typecheck + validate:layout + validate:renderer)
- [ ] `pnpm --filter @visual-notes/obsidian-plugin test:feature` passes
- [ ] `pnpm --filter @visual-notes/obsidian-plugin build` produces a clean main.js
- [ ] Manual QA in Obsidian completed (Task 17 Steps 4-7)
- [ ] No commits introduce dead code; no commented-out blocks left behind
- [ ] Follow-up issues mentioned in the spec are queued mentally for filing after merge
