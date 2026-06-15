import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// renderer.ts imports from "obsidian" (a host-provided module not available
// to the test esbuild bundle). Until the test runner adds `external:
// ["obsidian"]` plus a runtime shim, we lock the renderer contract by
// reading its source as a string and asserting against specific patterns
// rather than importing functions. This duplicates renderer-contract.mjs's
// substring checks intentionally — running `pnpm test:feature` alone (without
// `pnpm validate`) still surfaces styling/lifecycle regressions.
const rendererSource = readFileSync(resolve("src/renderer.ts"), "utf8");
const mainSource = readFileSync(resolve("src/main.ts"), "utf8");

describe("VisualNotesRenderChild — renderer source contract", () => {
  it("uses label-sized nodes with 11px / 500-weight text", () => {
    assert.match(rendererSource, /width: "label"/, "node width should be label-sized");
    assert.match(rendererSource, /height: "label"/, "node height should be label-sized");
    assert.match(rendererSource, /"font-size": 11/, "node font should be 11px");
    assert.match(rendererSource, /"font-weight": 500/, "node weight should be 500");
  });

  it("uses straight edges with calm 11px normal-weight labels", () => {
    assert.match(
      rendererSource,
      /"curve-style": "straight"/,
      "edge curve-style must be straight (bezier renders zero-size in cytoscape 3.28)",
    );
    assert.match(rendererSource, /"font-weight": "normal"/, "edge font weight should be normal");
    assert.match(rendererSource, /"text-background-opacity": 0\.92/, "edge label halo opacity");
    assert.match(rendererSource, /"text-background-padding": "4px"/, "edge label halo padding");
  });

  it("sets wheelSensitivity 0.3 in cytoscape init", () => {
    assert.match(
      rendererSource,
      /wheelSensitivity: 0\.3/,
      "renderer must set wheelSensitivity: 0.3 in the cytoscape constructor",
    );
  });

  it("binds hover interactions using Obsidian's --interactive-accent", () => {
    assert.match(
      rendererSource,
      /bindHoverInteractions/,
      "renderer must define bindHoverInteractions",
    );
    assert.match(
      rendererSource,
      /cy\.on\("mouseover", "node"/,
      "renderer must bind mouseover on node",
    );
    assert.match(
      rendererSource,
      /cy\.on\("mouseout", "node"/,
      "renderer must bind mouseout on node",
    );
    assert.match(
      rendererSource,
      /"--interactive-accent"/,
      "renderer must reference Obsidian's --interactive-accent for hover color",
    );
  });

  it("calls bindHoverInteractions() from renderGraph after cytoscape init", () => {
    // Lock the call site: bind must happen after the cy = cytoscape(...) constructor
    // so that this.cy is non-null when bindHoverInteractions checks it.
    const cyInitIndex = rendererSource.indexOf("this.cy = cytoscape({");
    const bindCallIndex = rendererSource.indexOf("this.bindHoverInteractions()");
    assert.ok(cyInitIndex >= 0, "renderer must call cytoscape({...}) constructor");
    assert.ok(bindCallIndex >= 0, "renderer must call this.bindHoverInteractions() from renderGraph");
    assert.ok(
      bindCallIndex > cyInitIndex,
      "bindHoverInteractions must be called AFTER cy is constructed",
    );
  });

  it("clears inline hover styles in applyTheme before reloading stylesheet", () => {
    // Otherwise hover-highlighted edges keep the previous theme's accent
    // color until the next mouseout, creating a visible mismatch.
    const applyThemeMatch = rendererSource.match(/private applyTheme\(\): void \{[\s\S]*?\n  \}/);
    assert.ok(applyThemeMatch, "renderer must define applyTheme");
    const body = applyThemeMatch[0];
    assert.match(body, /removeStyle\(\)/, "applyTheme must strip inline styles before reload");
    assert.ok(
      body.indexOf("removeStyle()") < body.indexOf("fromJson"),
      "removeStyle must run before fromJson(...).update()",
    );
  });

  it("destroys cytoscape on unload to prevent listener leaks", () => {
    assert.match(rendererSource, /destroyGraph/, "renderer must define destroyGraph");
    assert.match(rendererSource, /this\.cy\?\.destroy\(\)/, "destroyGraph must call cy.destroy()");
  });

  it("uses preset layout with fit: false (positions are LLM-authored, repair-only)", () => {
    assert.match(
      rendererSource,
      /layout: \{ name: "preset", fit: false \}/,
      "renderer must use preset layout — repair pass handles position correction, not cytoscape layout",
    );
  });

  it("exports sidecarPathForMarkdownPath as the canonical sidecar resolver", () => {
    // Static check — runtime tests for this helper require a test esbuild
    // config that externalizes "obsidian". Tracked as future work.
    assert.match(
      rendererSource,
      /^export function sidecarPathForMarkdownPath\(path: string\): string \{/m,
      "renderer must export sidecarPathForMarkdownPath as a top-level function",
    );
    assert.match(
      rendererSource,
      /normalizePath\(path\.replace\(\/\\\.md\$\/i, ""\) \+ "-overview\.json"\)/,
      "sidecarPathForMarkdownPath must strip .md and append -overview.json via Obsidian's normalizePath",
    );
  });
});

describe("VisualNotesRenderChild — render child options contract", () => {
  it("accepts an options parameter in the constructor", () => {
    assert.match(
      rendererSource,
      /options:\s*\{\s*removeContainerOnUnload\?:\s*boolean;\s*removeDuplicates\?:\s*boolean\s*\}\s*=\s*\{\}/,
      "constructor must accept an options bag with removeContainerOnUnload and removeDuplicates",
    );
  });

  it("defaults removeContainerOnUnload to true (legacy behavior)", () => {
    assert.match(
      rendererSource,
      /this\.removeContainerOnUnload\s*=\s*options\.removeContainerOnUnload\s*\?\?\s*true/,
      "removeContainerOnUnload must default to true to preserve legacy behavior",
    );
  });

  it("defaults removeDuplicates to true (legacy behavior)", () => {
    assert.match(
      rendererSource,
      /this\.removeDuplicates\s*=\s*options\.removeDuplicates\s*\?\?\s*true/,
      "removeDuplicates must default to true to preserve legacy behavior",
    );
  });

  it("gates containerEl.remove() in onunload behind removeContainerOnUnload", () => {
    const onunloadMatch = rendererSource.match(/onunload\(\): void \{[\s\S]*?\n  \}/);
    assert.ok(onunloadMatch, "renderer must define onunload");
    const body = onunloadMatch[0];
    assert.match(
      body,
      /if\s*\(\s*this\.removeContainerOnUnload\s*\)\s*\{[\s\S]*?this\.containerEl\.remove\(\)/,
      "onunload must gate this.containerEl.remove() behind the removeContainerOnUnload flag",
    );
  });

  it("early-returns from removeDuplicateContainersForSource when removeDuplicates is false", () => {
    const fnMatch = rendererSource.match(
      /private removeDuplicateContainersForSource\(\): void \{[\s\S]*?\n  \}/,
    );
    assert.ok(fnMatch, "renderer must define removeDuplicateContainersForSource");
    const body = fnMatch[0];
    assert.match(
      body,
      /if\s*\(!this\.removeDuplicates\)\s*\{\s*return;?\s*\}/,
      "removeDuplicateContainersForSource must early-return when removeDuplicates is false",
    );
  });
});

describe("VisualNotesPlugin — main.ts mount strategy contract", () => {
  it("registers a 'visual-notes' markdown codeblock processor", () => {
    assert.match(
      mainSource,
      /registerMarkdownCodeBlockProcessor\(\s*"visual-notes"/,
      "main.ts must register a markdown codeblock processor for 'visual-notes'",
    );
  });

  it("defines mountVisualNotesCodeBlock as the codeblock mount entry point", () => {
    assert.match(
      mainSource,
      /mountVisualNotesCodeBlock\s*\(/,
      "main.ts must define mountVisualNotesCodeBlock",
    );
  });

  it("creates VisualNotesRenderChild with removeContainerOnUnload: false and removeDuplicates: false", () => {
    const mountMatch = mainSource.match(
      /mountVisualNotesCodeBlock\([^)]*\):\s*void\s*\{[\s\S]*?\n  \}/,
    );
    assert.ok(mountMatch, "main.ts must define mountVisualNotesCodeBlock body");
    const body = mountMatch[0];
    assert.match(
      body,
      /new VisualNotesRenderChild\([\s\S]*?removeContainerOnUnload:\s*false[\s\S]*?removeDuplicates:\s*false[\s\S]*?\}\s*\)/,
      "codeblock mount must opt out of legacy container-remove + dedupe behaviors",
    );
  });

  it("references the codeblock host + container CSS classes", () => {
    assert.match(
      mainSource,
      /visual-notes-codeblock-host/,
      "main.ts must apply the codeblock host CSS class",
    );
    assert.match(
      mainSource,
      /visual-notes-codeblock-container/,
      "main.ts must apply the codeblock container CSS class",
    );
  });

  it("has removed the legacy auto-mount entry points (queueVisualNotesMount, mountVisualNotesForSource, setInterval)", () => {
    assert.doesNotMatch(
      mainSource,
      /queueVisualNotesMount/,
      "main.ts must no longer reference queueVisualNotesMount (legacy auto-mount removed)",
    );
    assert.doesNotMatch(
      mainSource,
      /mountVisualNotesForSource/,
      "main.ts must no longer reference mountVisualNotesForSource (legacy auto-mount removed)",
    );
    assert.doesNotMatch(
      mainSource,
      /setInterval/,
      "main.ts must no longer reference setInterval (legacy auto-mount polling removed)",
    );
  });
});

describe("VisualNotesRenderChild — zoom and fullscreen controls", () => {
  it("renders a controls toolbar in the header", () => {
    assert.match(
      rendererSource,
      /renderControls/,
      "renderer must define renderControls",
    );
    assert.match(
      rendererSource,
      /this\.renderControls\(header\)/,
      "renderGraph must call this.renderControls(header)",
    );
  });

  it("provides zoom-in and zoom-out methods that operate on cy.zoom", () => {
    assert.match(rendererSource, /private zoomIn\(\): void/, "renderer must define zoomIn");
    assert.match(rendererSource, /private zoomOut\(\): void/, "renderer must define zoomOut");
    assert.match(
      rendererSource,
      /this\.cy\.zoom\(.*level.*this\.cy\.zoom\(\) \* 1\.25/s,
      "zoomIn must scale cy.zoom by ×1.25",
    );
    assert.match(
      rendererSource,
      /this\.cy\.zoom\(.*level.*this\.cy\.zoom\(\) \/ 1\.25/s,
      "zoomOut must scale cy.zoom by ÷1.25",
    );
  });

  it("provides a toggleFullscreen method that adds/removes the fullscreen CSS class", () => {
    assert.match(
      rendererSource,
      /private toggleFullscreen\(\): void/,
      "renderer must define toggleFullscreen",
    );
    assert.match(
      rendererSource,
      /visual-notes-fullscreen/,
      "renderer must reference the visual-notes-fullscreen CSS class",
    );
    assert.match(
      rendererSource,
      /this\.containerEl\.addClass\("visual-notes-fullscreen"\)/,
      "toggleFullscreen must call addClass('visual-notes-fullscreen') when entering fullscreen",
    );
    assert.match(
      rendererSource,
      /this\.containerEl\.removeClass\("visual-notes-fullscreen"\)/,
      "toggleFullscreen must call removeClass('visual-notes-fullscreen') when exiting fullscreen",
    );
  });

  it("exits fullscreen on Escape keydown via registerDomEvent", () => {
    assert.match(
      rendererSource,
      /registerDomEvent\(document, "keydown"/,
      "renderer must register a keydown listener on document for Escape handling",
    );
    assert.match(
      rendererSource,
      /e\.key === "Escape" && this\.isFullscreen/,
      "keydown handler must check for Escape key and fullscreen state",
    );
  });

  it("clears fullscreen state in onunload to prevent stuck overlay on component destruction", () => {
    const onunloadMatch = rendererSource.match(/onunload\(\): void \{[\s\S]*?\n  \}/);
    assert.ok(onunloadMatch, "renderer must define onunload");
    const body = onunloadMatch[0];
    assert.match(
      body,
      /this\.isFullscreen/,
      "onunload must check this.isFullscreen before cleanup",
    );
    assert.match(
      body,
      /removeClass\("visual-notes-fullscreen"\)/,
      "onunload must remove the fullscreen class on component destruction",
    );
  });

  it("includes zoom and fullscreen buttons with accessible labels in renderControls", () => {
    const fnMatch = rendererSource.match(/private renderControls\([\s\S]*?\n  \}/);
    assert.ok(fnMatch, "renderer must define renderControls");
    const body = fnMatch[0];
    assert.match(body, /"Zoom in"/, "renderControls must include a zoom-in button");
    assert.match(body, /"Zoom out"/, "renderControls must include a zoom-out button");
    assert.match(body, /"Fit to view"/, "renderControls must include a fit-to-view button");
    assert.match(body, /fullscreen/, "renderControls must include a fullscreen button");
  });
});
