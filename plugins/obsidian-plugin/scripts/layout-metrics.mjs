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
  maxWidth: 1000,
  maxHeight: 660,
  minCardFitScale: 0.85,
  minNodeDistance: 100,
  maxClosePairs: 0,
  maxEdgeCrossings: 8,
  maxOutlierRatio: 2.25,
  maxPrimaryEdgeLength: 430,
  maxWeakEdgeLength: 780,
  maxWeakEdgeLengthBudget: 1800,
  maxComponentWidth: 640,
  maxComponentHeight: 460,
  minEstimatedDefaultNodeFontPx: 14.5,
};

const fixtures = [
  {
    name: "PR #7 prior horizontal spread",
    sidecar: {
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
    },
  },
  {
    name: "20-node daily swimlane overview",
    sidecar: {
      kind: "daily-overview",
      title: "Daily overview quality fixture",
      nodes: [
        node("daily-overview", "Daily\nOverview", "system active", 20, 120),
        node("visual-plugin", "Visual\nPlugin", "system completed", 120, 80),
        node("layout-engine", "Layout\nEngine", "system active", 120, 240),
        node("metric-gates", "Metric\nGates", "system active", 120, 400),
        node("test-vault", "Test\nVault", "system context", 120, 560),
        node("build-system", "Build\nSystem", "system context", 120, 720),

        node("label-readability", "Label\nReadability", "task active", 420, 80),
        node("card-fit", "Card\nFit", "task active", 420, 220),
        node("edge-clarity", "Edge\nClarity", "task active", 420, 360),
        node("plugin-deploy", "Plugin\nDeploy", "task completed", 420, 500),
        node("screenshot-check", "Screenshot\nCheck", "task completed", 420, 640),
        node("typecheck-build", "Typecheck\nBuild", "task completed", 420, 780),

        node("swimlane-choice", "Swimlane\nChoice", "decision active", 720, 90),
        node("reject-fan", "Reject\nFan Layout", "decision completed", 720, 240),
        node("draft-status", "Draft\nStatus", "decision active", 720, 390),
        node("quality-bar", "Quality\nBar", "decision context", 720, 540),

        node("vault-note", "Real Daily\nNote", "task context", 980, 120),
        node("review-feedback", "Review\nFeedback", "task context", 980, 280),
        node("remaining-risk", "Remaining\nRisk", "task blocked", 980, 440),
        node("future-rollups", "Future\nRollups", "task context", 980, 600),
      ],
      edges: [
        edge("daily-overview", "visual-plugin", "rendered by"),
        edge("visual-plugin", "layout-engine", "uses"),
        edge("layout-engine", "label-readability", "protects"),
        edge("layout-engine", "card-fit", "targets"),
        edge("layout-engine", "edge-clarity", "improves"),
        edge("metric-gates", "card-fit", "measures"),
        edge("metric-gates", "edge-clarity", "counts"),
        edge("metric-gates", "label-readability", "guards"),
        edge("test-vault", "plugin-deploy", "receives"),
        edge("plugin-deploy", "screenshot-check", "enables"),
        edge("build-system", "typecheck-build", "validates"),
        edge("swimlane-choice", "reject-fan", "replaces"),
        edge("swimlane-choice", "quality-bar", "supports"),
        edge("draft-status", "quality-bar", "depends on"),
        edge("vault-note", "screenshot-check", "anchors"),
        edge("review-feedback", "remaining-risk", "flags"),
        edge("future-rollups", "daily-overview", "extends", "weak-edge"),
        edge("review-feedback", "metric-gates", "encoded by", "weak-edge"),
      ],
    },
  },
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
  failures.push(...evaluateFixture(fixture.name, fixture.sidecar));
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

function evaluateFixture(name, sidecar) {
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

  return fixtureFailures;
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
  if (!rendererSource.includes('label: "data(displayLabel)"')) {
    persistenceFailures.push("renderer must use derived display labels so weak/long edges do not clutter the card");
  }
  if (!rendererSource.includes('"font-size": 17')) {
    persistenceFailures.push("renderer node font size should stay large enough for default-fit readability");
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
