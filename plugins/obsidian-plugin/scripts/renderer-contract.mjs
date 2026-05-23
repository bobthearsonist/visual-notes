import { readFile } from "node:fs/promises";
import { getSharedRendererSourceFailures } from "./shared-renderer-assertions.mjs";

const expectedProfiseeFixture = {
  nodeIds: [
    "ccusage",
    "token-limit",
    "init-ps1",
    "no-turns",
    "visual-notes",
    "test-artifacts",
    "py-script",
    "skill-repo-fix",
    "obsidian-testing",
    "obsidian-cli",
    "ai-private",
    "daily-overview",
  ],
  edges: [
    ["ccusage", "token-limit", "updated", "strong-edge"],
    ["ccusage", "init-ps1", "lives in", ""],
    ["ccusage", "no-turns", "investigated", ""],
    ["visual-notes", "test-artifacts", "cleaned up", "strong-edge"],
    ["visual-notes", "py-script", "removed", "strong-edge"],
    ["visual-notes", "skill-repo-fix", "required", ""],
    ["skill-repo-fix", "ai-private", "moved refs to", ""],
    ["obsidian-testing", "obsidian-cli", "discovered", "strong-edge"],
    ["visual-notes", "daily-overview", "testing now", ""],
    ["init-ps1", "ai-private", "same ecosystem", "weak-edge"],
    ["obsidian-testing", "daily-overview", "validates", "weak-edge"],
  ],
};

const rendererSource = await readFile(new URL("../src/renderer.ts", import.meta.url), "utf8");
const schemaSource = await readFile(new URL("../src/schema.ts", import.meta.url), "utf8");
const failures = [
  ...evaluateFixtureContract(),
  ...evaluateRendererSourceContract(rendererSource),
  ...evaluateSchemaContract(schemaSource),
];

console.log("Fixture: renderer MVP contract");
console.log(
  `Expected: ${expectedProfiseeFixture.nodeIds.length} nodes, ${expectedProfiseeFixture.edges.length} labeled edges`,
);

if (failures.length > 0) {
  console.error("Renderer contract failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("After:  flat hook-style renderer contract is preserved");
}

function evaluateFixtureContract() {
  const contractFailures = [];
  const nodeIds = expectedProfiseeFixture.nodeIds;
  const nodeIdSet = new Set(nodeIds);

  if (nodeIds.length !== 12) {
    contractFailures.push(`Profisee fixture should keep 12 nodes, got ${nodeIds.length}`);
  }
  if (expectedProfiseeFixture.edges.length !== 11) {
    contractFailures.push(`Profisee fixture should keep 11 edges, got ${expectedProfiseeFixture.edges.length}`);
  }
  if (nodeIdSet.size !== nodeIds.length) {
    contractFailures.push("Profisee fixture node ids must be unique");
  }

  expectedProfiseeFixture.edges.forEach(([source, target, label]) => {
    if (!nodeIdSet.has(source) || !nodeIdSet.has(target)) {
      contractFailures.push(`Profisee edge references missing endpoint: ${source}->${target}`);
    }
    if (!label.trim()) {
      contractFailures.push(`Profisee edge must keep a visible label: ${source}->${target}`);
    }
  });

  return contractFailures;
}

function evaluateRendererSourceContract(source) {
  const contractFailures = [...getSharedRendererSourceFailures(source)];
  const nodeElementIndex = source.indexOf("...sidecar.nodes.map");
  const edgeElementIndex = source.indexOf("...sidecar.edges.map");

  if (nodeElementIndex === -1 || edgeElementIndex === -1 || nodeElementIndex > edgeElementIndex) {
    contractFailures.push("renderer must emit sidecar nodes before sidecar edges");
  }
  if (source.includes("story-card") || /data:\s*\{[^}]*parent:/s.test(source)) {
    contractFailures.push("renderer must not synthesize Cytoscape compound parents or story-card nodes");
  }
  if (source.includes("visual-notes-debug") || source.includes("debug nodes=")) {
    contractFailures.push("renderer must not ship debug overlays");
  }
  if (source.includes("Unsupported sidecar kind")) {
    contractFailures.push("renderer must not reject schema-supported MVP sidecar kinds");
  }
  if (!source.includes("displayLabel: edge.data.label") || source.includes("edgeDisplayLabel")) {
    contractFailures.push("renderer must keep every sidecar edge label visible");
  }
  if (/selector:\s*"edge\.weak-edge"[\s\S]*label:\s*""/.test(source)) {
    contractFailures.push("weak edges must not blank their labels");
  }
  if (!source.includes('label: "data(displayLabel)"')) {
    contractFailures.push("renderer must bind visible Cytoscape labels");
  }
  if (!source.includes('"target-arrow-shape": "triangle"')) {
    contractFailures.push("renderer must keep MVP triangle arrowheads");
  }
  if (
    !source.includes('"font-size": 11') ||
    !source.includes('"font-weight": 500')
  ) {
    contractFailures.push("renderer must keep readable compact 11px/500-weight nodes (#21)");
  }
  if (!source.includes('width: "label"') || !source.includes('height: "label"')) {
    contractFailures.push("nodes must be label-sized (width/height: 'label') (#21)");
  }
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
  if (/selector:\s*"edge\.weak-edge"[\s\S]*opacity:/.test(source)) {
    contractFailures.push("weak edge labels must not be faded by edge opacity");
  }
  if (!source.includes('"z-index": 10') || !source.includes('"z-index": 1')) {
    contractFailures.push("renderer must keep nodes layered above relationship labels and edges");
  }
  if (!source.includes('layout: { name: "preset", fit: false }')) {
    contractFailures.push("renderer must preserve sidecar positions with preset layout and delayed fit");
  }
  if (!source.includes("new ResizeObserver") || !source.includes("requestAnimationFrame") || !source.includes("this.cy.fit(undefined, 40)")) {
    contractFailures.push("renderer must schedule a size-aware hook-style fit after Obsidian mount");
  }
  if (!source.includes("minZoom: 0.1")) {
    contractFailures.push("renderer must allow narrow-pane fitting with minZoom 0.1");
  }
  if (!source.includes("wheelSensitivity: 0.3")) {
    contractFailures.push("renderer must keep wheelSensitivity 0.3 for smooth zoom (#21)");
  }
  if (!source.includes("bindHoverInteractions") || !source.includes('cy.on("mouseover"')) {
    contractFailures.push("renderer must bind hover handlers for edge highlighting");
  }
  if (!source.includes("--interactive-accent")) {
    contractFailures.push("renderer must use Obsidian's --interactive-accent for hover color");
  }

  return contractFailures;
}

function evaluateSchemaContract(source) {
  const contractFailures = [];

  ["daily-overview", "session-whiteboard", "rollup"].forEach((kind) => {
    if (!source.includes(`"${kind}"`)) {
      contractFailures.push(`schema must keep MVP sidecar kind '${kind}'`);
    }
  });

  return contractFailures;
}
