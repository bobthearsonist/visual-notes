import { Buffer } from "node:buffer";
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

const layoutModule = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const { applyDeterministicLayout, calculateLayoutMetrics } = layoutModule;

const priorSpikeFixture = {
  kind: "daily-overview",
  title: "PR #7 deterministic layout fixture",
  nodes: [
    node("visual-notes", "Visual\nNotes", "system active", 220, 120),
    node("layout-engine", "Layout\nEngine", "system active", 220, 260),
    node("old-hook-strategy", "Old Hook\nStrategy", "system context", 220, 400),
    node("compact-clusters", "Compact\nClusters", "decision active", 220, 540),
    node("prior-spike", "Prior PR\nSpike", "task blocked", 220, 680),
    node("normal-pane", "Normal Pane\nWidth", "task completed", 220, 820),

    node("build-validation", "Build\nValidation", "system active", 690, 120),
    node("typecheck", "Typecheck", "task active", 690, 260),
    node("plugin-bundle", "Plugin\nBundle", "task completed", 690, 400),
    node("deterministic-metrics", "Deterministic\nMetrics", "task active", 690, 540),

    node("pr-seven", "PR #7", "system active", 1160, 120),
    node("draft-status", "Draft\nStatus", "decision active", 1160, 260),
    node("screenshot-capture", "Screenshot\nCapture", "task blocked", 1160, 400),
    node("evidence", "Layout\nEvidence", "task active", 1160, 540),

    node("issue-two", "Issue #2", "system active", 1630, 120),
    node("map-layout", "Map\nLayout", "task active", 1630, 260),
    node("main-branch", "Main\nBranch", "system context", 1630, 400),
  ],
  edges: [
    edge("visual-notes", "layout-engine", "renders through"),
    edge("layout-engine", "old-hook-strategy", "borrows"),
    edge("layout-engine", "compact-clusters", "uses"),
    edge("compact-clusters", "prior-spike", "replaces"),
    edge("compact-clusters", "normal-pane", "targets"),

    edge("build-validation", "typecheck", "runs"),
    edge("build-validation", "plugin-bundle", "produces"),
    edge("build-validation", "deterministic-metrics", "verifies"),

    edge("pr-seven", "draft-status", "keeps"),
    edge("pr-seven", "screenshot-capture", "needs"),
    edge("pr-seven", "evidence", "requires"),

    edge("issue-two", "map-layout", "tracks"),
    edge("issue-two", "main-branch", "compares"),

    edge("pr-seven", "issue-two", "implements", "weak-edge"),
    edge("evidence", "deterministic-metrics", "falls back to", "weak-edge"),
    edge("main-branch", "prior-spike", "worse than", "weak-edge"),
  ],
};

const before = calculateLayoutMetrics(priorSpikeFixture);
const afterSidecar = applyDeterministicLayout(priorSpikeFixture);
const after = calculateLayoutMetrics(afterSidecar);
const widthImprovement = (before.width - after.width) / before.width;
const radiusImprovement =
  (before.maxDistanceFromCentroid - after.maxDistanceFromCentroid) /
  before.maxDistanceFromCentroid;

console.log("Fixture: PR #7 reported spread x=220..1630");
console.log(
  `Before: width=${before.width}px height=${before.height}px maxRadius=${before.maxDistanceFromCentroid.toFixed(
    1,
  )} components=${before.componentCount}`,
);
console.log(
  `After:  width=${after.width}px height=${after.height}px maxRadius=${after.maxDistanceFromCentroid.toFixed(
    1,
  )} components=${after.componentCount}`,
);
console.log(
  `Improvement: width=${(widthImprovement * 100).toFixed(1)}% maxRadius=${(
    radiusImprovement * 100
  ).toFixed(1)}%`,
);
console.log("After coordinates:");
afterSidecar.nodes
  .map((fixtureNode) => `${fixtureNode.data.id}@${fixtureNode.position.x},${fixtureNode.position.y}`)
  .sort()
  .forEach((line) => console.log(`  ${line}`));

const failures = [];
if (after.width > 1100) {
  failures.push(`expected layout width <= 1100px, got ${after.width}px`);
}
if (after.maxX > 1100) {
  failures.push(`expected max x <= 1100px, got ${after.maxX}px`);
}
if (widthImprovement < 0.2) {
  failures.push(`expected width improvement >= 20%, got ${(widthImprovement * 100).toFixed(1)}%`);
}
if (radiusImprovement < 0.2) {
  failures.push(
    `expected max-radius improvement >= 20%, got ${(radiusImprovement * 100).toFixed(1)}%`,
  );
}

if (failures.length > 0) {
  console.error("Layout metrics failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
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
