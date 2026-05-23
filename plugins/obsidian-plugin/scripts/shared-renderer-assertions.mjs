// Shared renderer-source assertions used by both validate gates:
//   - renderer-contract.mjs (validate:renderer)
//   - layout-metrics.mjs    (validate:layout)
//
// Both scripts run as independent validation paths and need to be
// self-contained. Without this shared module they previously duplicated
// the same substring checks across both files, creating drift risk:
// if one script's assertions diverged from the other's, a future PR
// could land code that satisfies one gate but breaks the other.
//
// Each script imports `getSharedRendererSourceFailures(source)` and
// appends the returned failures to its own failure list, then runs its
// own script-specific assertions on top.

export function getSharedRendererSourceFailures(source) {
  const failures = [];

  if (source.includes("applyDeterministicLayout")) {
    failures.push("renderer must not import or call applyDeterministicLayout");
  }
  if (!source.includes("this.renderGraph(sidecar);")) {
    failures.push("renderer must pass parsed sidecar positions directly into renderGraph");
  }
  if (!source.includes('"curve-style": "straight"')) {
    failures.push("renderer must use straight edges (bezier renders zero-size in cytoscape 3.28)");
  }

  return failures;
}
