import assert from "node:assert/strict";
import test from "node:test";
import { mergeSectionedGraph } from "../../src/sectioned-sidecar";
import { parseMarkdownSections } from "../../src/sections";
import type {
  VisualNotesEdge,
  VisualNotesNode,
  VisualNotesSectionMetadata,
  VisualNotesSidecar,
} from "../../src/schema";

const HASH_A = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HASH_C = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

test("parseMarkdownSections ignores headings inside fenced code blocks", () => {
  const sections = parseMarkdownSections(`# Daily

Intro.

\`\`\`md
## Not a real heading
\`\`\`

## Real section
Body.
`);

  assert.deepEqual(
    sections.map((section) => section.id),
    ["h1-daily", "h1-daily-h2-real-section"],
  );
  assert.equal(sections[1].title, "Real section");
});

test("mergeSectionedGraph preserves unchanged section fragments and positions", () => {
  const sections = [
    section("document", "Document", 0, HASH_A),
    section("h1-daily-h2-stable", "Stable", 1, HASH_B),
    section("h1-daily-h2-changed", "Changed", 2, HASH_C),
  ];
  const existing = sidecar({
    nodes: [
      node("stable-node", "Stable node", "h1-daily-h2-stable", { x: 111, y: 222 }),
      node("changed-old", "Changed old", "h1-daily-h2-changed", { x: 333, y: 444 }),
    ],
    edges: [edge("stable-node", "changed-old", "mentions", "h1-daily-h2-stable")],
    sections: [
      metadata(sections[0], [], []),
      metadata(sections[1], ["stable-node"], ["edge-stable-node-changed-old-mentions"]),
      metadata({ ...sections[2], hash: HASH_B }, ["changed-old"], []),
    ],
  });

  const result = mergeSectionedGraph({
    existing,
    force: false,
    sections,
    extracted: {
      nodes: [
        node("stable-node", "LLM rewrote stable", "h1-daily-h2-stable", { x: 999, y: 999 }),
        node("changed-new", "Changed new", "h1-daily-h2-changed", { x: 500, y: 600 }),
      ],
      edges: [edge("stable-node", "changed-new", "updated by", "h1-daily-h2-changed")],
    },
  });

  assert.deepEqual(
    result.nodes.map((entry) => [entry.data.id, entry.position]),
    [
      ["stable-node", { x: 111, y: 222 }],
      ["changed-new", { x: 500, y: 600 }],
    ],
  );
  assert.deepEqual(
    result.sections.find((entry) => entry.id === "h1-daily-h2-stable")?.nodeIds,
    ["stable-node"],
  );
  assert.deepEqual(
    result.sections.find((entry) => entry.id === "h1-daily-h2-changed")?.nodeIds,
    ["changed-new"],
  );
});

test("mergeSectionedGraph assigns unattributed single-section extraction deterministically", () => {
  const sections = [section("h1-meeting-notes", "Meeting Notes", 0, HASH_A)];
  const result = mergeSectionedGraph({
    existing: null,
    force: false,
    sections,
    extracted: {
      nodes: [node("meeting-action", "Meeting action", undefined, { x: 10, y: 20 })],
      edges: [],
    },
  });

  assert.equal(result.nodes[0].data.sectionId, "h1-meeting-notes");
  assert.deepEqual(result.sections[0].nodeIds, ["meeting-action"]);
});

test("mergeSectionedGraph strips invalid section references when attribution is ambiguous", () => {
  const sections = [
    section("h1-alpha", "Alpha", 0, HASH_A),
    section("h1-beta", "Beta", 1, HASH_B),
  ];
  const result = mergeSectionedGraph({
    existing: null,
    force: false,
    sections,
    extracted: {
      nodes: [node("orphan", "Orphan", "not-a-current-section", { x: 10, y: 20 })],
      edges: [],
    },
  });

  assert.equal(result.nodes[0].data.sectionId, undefined);
  assert.deepEqual(result.sections.flatMap((entry) => entry.nodeIds), []);
});

function section(
  id: string,
  title: string,
  ordinal: number,
  hash: string,
) {
  return {
    id,
    title,
    level: id === "document" ? 0 : 2,
    ordinal,
    startLine: ordinal + 1,
    endLine: ordinal + 2,
    hash,
  };
}

function metadata(
  section: ReturnType<typeof section>,
  nodeIds: string[],
  edgeIds: string[],
): VisualNotesSectionMetadata {
  return { ...section, nodeIds, edgeIds };
}

function sidecar(options: {
  nodes: VisualNotesNode[];
  edges: VisualNotesEdge[];
  sections: VisualNotesSectionMetadata[];
}): VisualNotesSidecar {
  return {
    nodes: options.nodes,
    edges: options.edges,
    _sections: options.sections,
  };
}

function node(
  id: string,
  label: string,
  sectionId: string | undefined,
  position: { x: number; y: number },
): VisualNotesNode {
  return {
    data: sectionId ? { id, label, sectionId } : { id, label },
    classes: "task active",
    position,
  };
}

function edge(
  source: string,
  target: string,
  label: string,
  sectionId: string | undefined,
): VisualNotesEdge {
  return {
    data: sectionId ? { source, target, label, sectionId } : { source, target, label },
    classes: "strong-edge",
  };
}
