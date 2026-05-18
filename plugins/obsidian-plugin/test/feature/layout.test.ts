import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyDeterministicLayout } from "../../src/layout";
import type { VisualNotesSidecar } from "../../src/schema";

function loadNarrativeFixture(): VisualNotesSidecar {
  const raw = readFileSync(resolve("test/fixtures/narrative-positioned-overview.json"), "utf8");
  return JSON.parse(raw) as VisualNotesSidecar;
}

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
});
