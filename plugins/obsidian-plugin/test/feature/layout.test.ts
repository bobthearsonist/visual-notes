import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyDeterministicLayout } from "../../src/layout";
import type { VisualNotesSidecar } from "../../src/schema";

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

function loadNarrativeFixture(): VisualNotesSidecar {
  const raw = readFileSync(resolve("test/fixtures/narrative-positioned-overview.json"), "utf8");
  return JSON.parse(raw) as VisualNotesSidecar;
}

const SCHEMA_MIN_X_BOUND = -200;
const SCHEMA_MAX_X_BOUND = 5000;
const SCHEMA_MIN_Y_BOUND = -200;
const SCHEMA_MAX_Y_BOUND = 3000;

describe("applyDeterministicLayout — repair pass", () => {
  it("preserves well-placed LLM positions unchanged", () => {
    const sidecar = loadNarrativeFixture();
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
});
