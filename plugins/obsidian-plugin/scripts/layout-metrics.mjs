import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const pluginRoot = fileURLToPath(new URL("..", import.meta.url));

const result = await build({
  entryPoints: ["src/layout.ts"],
  absWorkingDir: pluginRoot,
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});

const source = result.outputFiles[0]?.text;
if (!source) {
  throw new Error("esbuild did not emit a bundled layout module");
}

const layoutModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const { applyDeterministicLayout, calculateLayoutMetrics } = layoutModule;

const qualityGate = {
  maxWidth: 1500,
  maxHeight: 800,
  minCardFitScale: 0.6,
  minNodeDistance: 65,
  maxClosePairs: 0,
  maxEdgeCrossings: 12,
  maxOutlierRatio: 3.5,
  maxPrimaryEdgeLength: 900,
  maxWeakEdgeLength: 1000,
  maxWeakEdgeLengthBudget: 2400,
  maxComponentWidth: 1500,
  maxComponentHeight: 800,
  // Threshold scaled with NODE_FONT_SIZE = 11 (#21 fixed stale 13).
  // estimatedDefaultNodeFontPx = NODE_FONT_SIZE * min(cardFitScale, 1);
  // narrative fixture's cardFitScale ≈ 0.67 ⇒ ≈ 7.4px effective.
  // Floor of 7 catches truly cramped renders without over-rejecting normal data.
  minEstimatedDefaultNodeFontPx: 7,
};

const narrativeOverviewPath = new URL(
  "../test/fixtures/narrative-positioned-overview.json",
  import.meta.url,
);
const narrativeSidecar = JSON.parse(await readFile(narrativeOverviewPath, "utf8"));

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

const args = process.argv.slice(2);
const shouldWrite = args.includes("--write");
const sidecarPaths = args.filter((arg) => arg !== "--write");
const sidecarInputs = [];

for (const sidecarPath of sidecarPaths) {
  const sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
  sidecarInputs.push({ path: sidecarPath, sidecar });
  fixtures.push({ name: sidecarPath, sidecar });
}

const failures = [];
for (const fixture of fixtures) {
  failures.push(...evaluateFixture(fixture));
}
failures.push(...evaluateEmptyGraph());
failures.push(...(await evaluateRenderPersistence()));

if (failures.length > 0) {
  console.error("Layout metrics failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else if (shouldWrite) {
  for (const input of sidecarInputs) {
    const laidOut = applyDeterministicLayout(input.sidecar);
    await writeFile(input.path, `${JSON.stringify(laidOut, null, 2)}\n`);
    console.log(`Wrote deterministic layout: ${input.path}`);
  }
}

function evaluateFixture(fixture) {
  const { name, sidecar, expected } = fixture;
  const before = calculateLayoutMetrics(sidecar);
  const afterSidecar = applyDeterministicLayout(sidecar);
  const after = calculateLayoutMetrics(afterSidecar);
  const widthImprovement = improvement(before.width, after.width);
  const radiusImprovement = improvement(before.maxDistanceFromCentroid, after.maxDistanceFromCentroid);
  const fixtureFailures = [];

  console.log(`Fixture: ${name}`);
  console.log(
    `Before: width=${before.width}px height=${before.height}px radius=${before.maxDistanceFromCentroid.toFixed(
      1,
    )} crossings=${before.edgeCrossingCount} closePairs=${before.closePairCount}`,
  );
  console.log(
    `After:  width=${after.width}px height=${after.height}px fit=${after.cardFitScale.toFixed(
      2,
    )} minDistance=${after.minNodeDistance.toFixed(1)} crossings=${after.edgeCrossingCount} closePairs=${
      after.closePairCount
    } maxEdge=${after.maxPrimaryEdgeLength.toFixed(1)} maxWeak=${after.maxWeakEdgeLength.toFixed(
      1,
    )} weakBudget=${after.weakEdgeLengthBudget.toFixed(1)} font=${after.estimatedDefaultNodeFontPx.toFixed(
      1,
    )} outlier=${after.maxOutlierRatio.toFixed(2)} component=${after.maxComponentWidth}x${
      after.maxComponentHeight
    }`,
  );
  console.log(
    `Improvement: width=${(widthImprovement * 100).toFixed(1)}% maxRadius=${(
      radiusImprovement * 100
    ).toFixed(1)}%`,
  );

  if (after.width > qualityGate.maxWidth) {
    fixtureFailures.push(`${name}: expected width <= ${qualityGate.maxWidth}px, got ${after.width}px`);
  }
  if (after.height > qualityGate.maxHeight) {
    fixtureFailures.push(`${name}: expected height <= ${qualityGate.maxHeight}px, got ${after.height}px`);
  }
  if (after.cardFitScale < qualityGate.minCardFitScale) {
    fixtureFailures.push(
      `${name}: expected card fit scale >= ${qualityGate.minCardFitScale}, got ${after.cardFitScale.toFixed(2)}`,
    );
  }
  if (after.minNodeDistance < qualityGate.minNodeDistance) {
    fixtureFailures.push(
      `${name}: expected min node distance >= ${qualityGate.minNodeDistance}px, got ${after.minNodeDistance.toFixed(
        1,
      )}px`,
    );
  }
  if (after.closePairCount > qualityGate.maxClosePairs) {
    fixtureFailures.push(
      `${name}: expected close pairs <= ${qualityGate.maxClosePairs}, got ${after.closePairCount}`,
    );
  }
  if (after.edgeCrossingCount > qualityGate.maxEdgeCrossings) {
    fixtureFailures.push(
      `${name}: expected edge crossings <= ${qualityGate.maxEdgeCrossings}, got ${after.edgeCrossingCount}`,
    );
  }
  if (after.maxOutlierRatio > qualityGate.maxOutlierRatio) {
    fixtureFailures.push(
      `${name}: expected outlier ratio <= ${qualityGate.maxOutlierRatio}, got ${after.maxOutlierRatio.toFixed(2)}`,
    );
  }
  if (after.maxPrimaryEdgeLength > qualityGate.maxPrimaryEdgeLength) {
    fixtureFailures.push(
      `${name}: expected max primary edge length <= ${qualityGate.maxPrimaryEdgeLength}px, got ${after.maxPrimaryEdgeLength.toFixed(
        1,
      )}px`,
    );
  }
  if (after.maxWeakEdgeLength > qualityGate.maxWeakEdgeLength) {
    fixtureFailures.push(
      `${name}: expected max weak edge length <= ${qualityGate.maxWeakEdgeLength}px, got ${after.maxWeakEdgeLength.toFixed(
        1,
      )}px`,
    );
  }
  if (after.weakEdgeLengthBudget > qualityGate.maxWeakEdgeLengthBudget) {
    fixtureFailures.push(
      `${name}: expected weak edge length budget <= ${qualityGate.maxWeakEdgeLengthBudget}px, got ${after.weakEdgeLengthBudget.toFixed(
        1,
      )}px`,
    );
  }
  if (after.maxComponentWidth > qualityGate.maxComponentWidth) {
    fixtureFailures.push(
      `${name}: expected max component width <= ${qualityGate.maxComponentWidth}px, got ${after.maxComponentWidth}px`,
    );
  }
  if (after.estimatedDefaultNodeFontPx < qualityGate.minEstimatedDefaultNodeFontPx) {
    fixtureFailures.push(
      `${name}: expected estimated rendered node font >= ${
        qualityGate.minEstimatedDefaultNodeFontPx
      }px, got ${after.estimatedDefaultNodeFontPx.toFixed(1)}px`,
    );
  }
  if (after.maxComponentHeight > qualityGate.maxComponentHeight) {
    fixtureFailures.push(
      `${name}: expected max component height <= ${qualityGate.maxComponentHeight}px, got ${after.maxComponentHeight}px`,
    );
  }
  if (expected) {
    fixtureFailures.push(...evaluateSidecarContract(name, sidecar, expected));
  }

  return fixtureFailures;
}

function evaluateSidecarContract(name, sidecar, expected) {
  const contractFailures = [];
  const nodeIds = sidecar.nodes.map((node) => node.data.id);
  const nodeIdSet = new Set(nodeIds);

  if (sidecar.nodes.length !== expected.nodeCount) {
    contractFailures.push(`${name}: expected ${expected.nodeCount} nodes, got ${sidecar.nodes.length}`);
  }
  if (sidecar.edges.length !== expected.edgeCount) {
    contractFailures.push(`${name}: expected ${expected.edgeCount} edges, got ${sidecar.edges.length}`);
  }

  const missingNodeIds = expected.nodeIds.filter((id) => !nodeIdSet.has(id));
  if (missingNodeIds.length > 0) {
    contractFailures.push(`${name}: missing node ids ${missingNodeIds.join(", ")}`);
  }

  const duplicateNodeIds = nodeIds.filter((id, index) => nodeIds.indexOf(id) !== index);
  if (duplicateNodeIds.length > 0) {
    contractFailures.push(`${name}: duplicate node ids ${[...new Set(duplicateNodeIds)].join(", ")}`);
  }

  const invalidEdges = sidecar.edges
    .filter((edge) => !nodeIdSet.has(edge.data.source) || !nodeIdSet.has(edge.data.target))
    .map((edge) => `${edge.data.source}->${edge.data.target}`);
  if (invalidEdges.length > 0) {
    contractFailures.push(`${name}: edges reference missing endpoints ${invalidEdges.join(", ")}`);
  }

  const unlabeledEdges = sidecar.edges
    .filter((edge) => !edge.data.label?.trim())
    .map((edge) => `${edge.data.source}->${edge.data.target}`);
  if (unlabeledEdges.length > 0) {
    contractFailures.push(`${name}: edges missing labels ${unlabeledEdges.join(", ")}`);
  }

  return contractFailures;
}

function evaluateEmptyGraph() {
  const metrics = calculateLayoutMetrics({ nodes: [], edges: [] });
  const values = Object.values(metrics);
  if (values.some((value) => typeof value === "number" && !Number.isFinite(value))) {
    return ["empty graph metrics should be finite"];
  }

  console.log("Fixture: empty graph defensive metrics");
  console.log(
    `After:  width=${metrics.width}px height=${metrics.height}px fit=${metrics.cardFitScale.toFixed(
      2,
    )} closePairs=${metrics.closePairCount}`,
  );
  return [];
}

async function evaluateRenderPersistence() {
  const rendererSource = await readFile(new URL("../src/renderer.ts", import.meta.url), "utf8");
  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const persistenceFailures = [];

  if (rendererSource.includes("applyDeterministicLayout")) {
    persistenceFailures.push("renderer must not import or call applyDeterministicLayout");
  }
  if (!rendererSource.includes("this.renderGraph(sidecar);")) {
    persistenceFailures.push("renderer must pass parsed sidecar positions directly into renderGraph");
  }
  const nodeElementIndex = rendererSource.indexOf("...sidecar.nodes.map");
  const edgeElementIndex = rendererSource.indexOf("...sidecar.edges.map");

  if (!rendererSource.includes('label: "data(displayLabel)"')) {
    persistenceFailures.push("renderer must render visible node and edge labels");
  }
  if (nodeElementIndex === -1 || edgeElementIndex === -1 || nodeElementIndex > edgeElementIndex) {
    persistenceFailures.push("renderer must provide nodes before edges so relationship endpoints exist");
  }
  if (rendererSource.includes("story-card") || /data:\s*\{[^}]*parent:/s.test(rendererSource)) {
    persistenceFailures.push("renderer must not synthesize compound story-card parents");
  }
  if (!rendererSource.includes('"curve-style": "straight"')) {
    persistenceFailures.push("renderer must use straight edges (bezier renders as zero-size in cytoscape 3.28 — see #21 QA finding)");
  }
  if (!rendererSource.includes("layout: { name: \"preset\", fit: false }")) {
    persistenceFailures.push("renderer must use preset layout without recalculating sidecar positions");
  }
  if (!rendererSource.includes("new ResizeObserver") || !rendererSource.includes("this.cy.fit(undefined, 40)")) {
    persistenceFailures.push("renderer must schedule a size-aware hook-style fit after Obsidian mounts the graph");
  }
  if (rendererSource.includes("displayLabel: edgeDisplayLabel") || /selector:\s*"edge\.weak-edge"[\s\S]*label:\s*""/.test(rendererSource)) {
    persistenceFailures.push("renderer must keep all sidecar edge labels visible like the MVP hook renderer");
  }
  if (
    !rendererSource.includes('"font-size": 11') ||
    !rendererSource.includes('"font-weight": 500') ||
    !rendererSource.includes('width: "label"') ||
    !rendererSource.includes('height: "label"')
  ) {
    persistenceFailures.push("renderer node sizing should use label-sized 11px/500-weight nodes (#21)");
  }
  if (
    !rendererSource.includes('"font-size": 11') ||
    !rendererSource.includes('"font-weight": "normal"') ||
    !rendererSource.includes('"arrow-scale": 1.1')
  ) {
    persistenceFailures.push("renderer edge labels should be readable while keeping hook-style arrow scale (#21)");
  }
  if (!rendererSource.includes('"text-background-opacity": 0.92') || !rendererSource.includes('"text-background-padding": "4px"')) {
    persistenceFailures.push("renderer edge labels should keep a readable background halo (#21)");
  }
  if (/selector:\s*"edge\.weak-edge"[\s\S]*opacity:/.test(rendererSource)) {
    persistenceFailures.push("renderer weak edge labels must not be faded by edge opacity");
  }
  if (!mainSource.includes("applyDeterministicLayout({")) {
    persistenceFailures.push("extraction/write path must apply deterministic layout before persisting sidecars");
  }

  console.log("Fixture: render persistence guard");
  if (persistenceFailures.length === 0) {
    console.log("After:  renderer preserves stored positions; extraction/write path applies deterministic layout");
  }

  return persistenceFailures;
}

function improvement(before, after) {
  if (before <= 0) {
    return 0;
  }

  return (before - after) / before;
}

function node(id, label, classes, x, y) {
  return {
    data: { id, label },
    classes,
    position: { x, y },
  };
}

function edge(source, target, label, classes = "strong-edge") {
  return {
    data: { source, target, label },
    classes,
  };
}
