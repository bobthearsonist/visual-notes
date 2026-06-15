import cytoscape from "cytoscape";
import { EventRef, MarkdownRenderChild, normalizePath } from "obsidian";
import type VisualNotesPlugin from "./main";
import { parseSidecar, type VisualNotesSidecar } from "./schema";

export function sidecarPathForMarkdownPath(path: string): string {
  return normalizePath(path.replace(/\.md$/i, "") + "-overview.json");
}

export class VisualNotesRenderChild extends MarkdownRenderChild {
  private cy: cytoscape.Core | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private refitScheduled = false;
  private sidecarEventRef: EventRef | null = null;
  private readonly sidecarPath: string;
  private readonly sourcePath: string;
  private readonly removeContainerOnUnload: boolean;
  private readonly removeDuplicates: boolean;
  private isFullscreen = false;
  private fullscreenBtn: HTMLElement | null = null;

  constructor(
    containerEl: HTMLElement,
    private readonly plugin: VisualNotesPlugin,
    sourcePath: string,
    options: { removeContainerOnUnload?: boolean; removeDuplicates?: boolean } = {},
  ) {
    super(containerEl);
    this.sourcePath = sourcePath;
    this.sidecarPath = sidecarPathForMarkdownPath(sourcePath);
    this.removeContainerOnUnload = options.removeContainerOnUnload ?? true;
    this.removeDuplicates = options.removeDuplicates ?? true;
  }

  onload(): void {
    this.removeDuplicateContainersForSource();
    this.sidecarEventRef = this.plugin.sidecarEvents.on("changed", (sidecarPath: unknown) => {
      if (typeof sidecarPath === "string" && normalizePath(sidecarPath) === this.sidecarPath) {
        void this.render();
      }
    });
    this.registerEvent(this.sidecarEventRef);
    this.registerEvent(this.plugin.app.workspace.on("css-change", () => this.applyTheme()));
    this.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.isFullscreen) {
        e.preventDefault();
        this.toggleFullscreen();
      }
    });
    void this.render();
  }

  onunload(): void {
    if (this.isFullscreen) {
      this.isFullscreen = false;
      this.containerEl.removeClass("visual-notes-fullscreen");
    }
    this.destroyGraph();
    if (this.removeContainerOnUnload) {
      this.containerEl.remove();
    }
    this.sidecarEventRef = null;
  }

  async refresh(): Promise<void> {
    this.removeDuplicateContainersForSource();
    await this.render();
  }

  private async render(): Promise<void> {
    if (!(await this.plugin.app.vault.adapter.exists(this.sidecarPath))) {
      this.hide();
      return;
    }

    try {
      const raw = await this.plugin.app.vault.adapter.read(this.sidecarPath);
      const sidecar = parseSidecar(JSON.parse(raw));
      this.renderGraph(sidecar);
    } catch (error) {
      this.plugin.log("error", "Failed to render sidecar.", { sidecarPath: this.sidecarPath, error });
      this.showPlaceholder("Visual Notes: malformed sidecar. See console for details.");
    }
  }

  private renderGraph(sidecar: VisualNotesSidecar): void {
    this.removeDuplicateContainersForSource();
    this.destroyGraph();
    this.prepareVisibleContainer();

    const header = this.containerEl.createDiv({ cls: "visual-notes-header" });
    const heading = header.createDiv({ cls: "visual-notes-heading" });
    heading.createDiv({
      cls: "visual-notes-title",
      text: sidecar.header ?? sidecar.title ?? "Daily Overview",
    });

    if (sidecar.subtitle) {
      heading.createDiv({ cls: "visual-notes-subtitle", text: sidecar.subtitle });
    }

    this.renderLegend(header);
    this.renderControls(header);

    const graphEl = this.containerEl.createDiv({ cls: "visual-notes-graph" });
    const elements: cytoscape.ElementDefinition[] = [
      ...sidecar.nodes.map((node) => ({
        group: "nodes" as const,
        data: {
          ...node.data,
          displayLabel: node.data.label,
        },
        classes: node.classes ?? "",
        position: node.position,
      })),
      ...sidecar.edges.map((edge) => ({
        group: "edges" as const,
        data: {
          ...edge.data,
          displayLabel: edge.data.label,
        },
        classes: edge.classes ?? "",
      })),
    ];

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
    this.scheduleRefitGraph();

    this.containerEl.createDiv({
      cls: "visual-notes-source",
      text: formatSourceSummary(sidecar),
    });

    if (sidecar._usage) {
      this.containerEl.createDiv({
        cls: "visual-notes-usage",
        text: `Last: ${formatTokenSummary(sidecar._usage.last)} (${formatUsd(
          sidecar._usage.last.estimatedCostUsd,
        )}) · Cumulative: ${formatTokenSummary(sidecar._usage.cumulative)} (${formatUsd(
          sidecar._usage.cumulative.estimatedCostUsd,
        )}) across ${sidecar._usage.cumulative.extractions} extraction${sidecar._usage.cumulative.extractions === 1 ? "" : "s"}`,
      });
    }
  }

  private renderLegend(parent: HTMLElement): void {
    const legend = parent.createDiv({ cls: "visual-notes-legend" });
    legend.setAttribute("aria-label", "Visual Notes legend");

    this.renderLegendGroup(legend, "Status", [
      ["visual-notes-legend-status-completed", "done"],
      ["visual-notes-legend-status-active", "active"],
      ["visual-notes-legend-status-context", "context"],
      ["visual-notes-legend-status-blocked", "blocked"],
    ]);
    this.renderLegendGroup(legend, "Type", [
      ["visual-notes-legend-type-system", "system"],
      ["visual-notes-legend-type-task", "task"],
      ["visual-notes-legend-type-decision", "decision"],
    ]);
    this.renderLegendGroup(legend, "Edge", [
      ["visual-notes-legend-edge-strong", "strong"],
      ["visual-notes-legend-edge-weak", "weak"],
    ]);
  }

  private renderLegendGroup(
    legend: HTMLElement,
    title: string,
    items: Array<[swatchClass: string, label: string]>,
  ): void {
    const group = legend.createDiv({ cls: "visual-notes-legend-group" });
    group.createDiv({ cls: "visual-notes-legend-label", text: title });

    items.forEach(([swatchClass, label]) => {
      const item = group.createDiv({ cls: "visual-notes-legend-item" });
      item.createDiv({ cls: `visual-notes-legend-swatch ${swatchClass}` });
      item.createDiv({ cls: "visual-notes-legend-text", text: label });
    });
  }

  private renderControls(parent: HTMLElement): void {
    const controls = parent.createDiv({ cls: "visual-notes-controls" });

    const zoomOutBtn = controls.createEl("button", {
      cls: "visual-notes-btn",
      attr: { "aria-label": "Zoom out", title: "Zoom out" },
      text: "−",
    });

    const zoomInBtn = controls.createEl("button", {
      cls: "visual-notes-btn",
      attr: { "aria-label": "Zoom in", title: "Zoom in" },
      text: "+",
    });

    const fitBtn = controls.createEl("button", {
      cls: "visual-notes-btn",
      attr: { "aria-label": "Fit to view", title: "Fit to view" },
      text: "⊡",
    });

    this.fullscreenBtn = controls.createEl("button", {
      cls: "visual-notes-btn",
      attr: {
        "aria-label": this.isFullscreen ? "Exit fullscreen" : "Enter fullscreen",
        title: this.isFullscreen ? "Exit fullscreen" : "Enter fullscreen",
      },
      text: this.isFullscreen ? "✕" : "⛶",
    });

    zoomOutBtn.addEventListener("click", () => this.zoomOut());
    zoomInBtn.addEventListener("click", () => this.zoomIn());
    fitBtn.addEventListener("click", () => this.refitGraph());
    this.fullscreenBtn.addEventListener("click", () => this.toggleFullscreen());
  }

  private zoomIn(): void {
    if (!this.cy) return;
    this.cy.zoom({
      level: this.cy.zoom() * 1.25,
      renderedPosition: { x: this.cy.width() / 2, y: this.cy.height() / 2 },
    });
  }

  private zoomOut(): void {
    if (!this.cy) return;
    this.cy.zoom({
      level: this.cy.zoom() / 1.25,
      renderedPosition: { x: this.cy.width() / 2, y: this.cy.height() / 2 },
    });
  }

  private toggleFullscreen(): void {
    this.isFullscreen = !this.isFullscreen;
    if (this.isFullscreen) {
      this.containerEl.addClass("visual-notes-fullscreen");
    } else {
      this.containerEl.removeClass("visual-notes-fullscreen");
    }
    if (this.fullscreenBtn) {
      this.fullscreenBtn.textContent = this.isFullscreen ? "✕" : "⛶";
      this.fullscreenBtn.setAttribute(
        "aria-label",
        this.isFullscreen ? "Exit fullscreen" : "Enter fullscreen",
      );
      this.fullscreenBtn.setAttribute(
        "title",
        this.isFullscreen ? "Exit fullscreen" : "Enter fullscreen",
      );
    }
    this.scheduleRefitGraph();
  }

  private applyTheme(): void {
    if (!this.cy) {
      return;
    }

    // Strip any in-flight hover inline styles before reloading the
    // stylesheet — otherwise hovered edges keep the previous theme's
    // accent color until the next mouseout.
    this.cy.elements().removeStyle();
    this.cy.style().fromJson(this.createStyle()).update();
  }

  private observeGraphSize(graphEl: HTMLElement): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.scheduleRefitGraph());
    this.resizeObserver.observe(graphEl);
  }

  private scheduleRefitGraph(): void {
    if (this.refitScheduled) {
      return;
    }

    this.refitScheduled = true;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        this.refitScheduled = false;
        this.refitGraph();
      });
    });
  }

  private refitGraph(): void {
    if (!this.cy) {
      return;
    }

    const container = this.cy.container();
    if (!container || container.clientWidth <= 0 || container.clientHeight <= 0) {
      return;
    }

    this.cy.resize();
    this.cy.fit(undefined, 40);
  }

  private createStyle(): cytoscape.StylesheetJson {
    const computed = getComputedStyle(this.containerEl);
    // theme.muted is the edge label color — intentionally de-emphasized
    // against bolder node fills. Obsidian's --text-muted is legible against
    // --background-primary in both light and dark themes; the hardcoded
    // fallback only triggers in non-Obsidian dev contexts.
    const theme = {
      muted: getCssVariable(computed, "--text-muted", "#a6adc8"),
      background: getCssVariable(computed, "--background-primary", "#1e1e2e"),
      border: getCssVariable(computed, "--background-modifier-border", "#45475a"),
      edge: getCssVariable(computed, "--text-muted", "#8c8fa1"),
      nodeText: "#1e1e2e",
      completedBg: "#a6e3a1",
      completedBorder: "#40a02b",
      activeBg: "#f9e2af",
      activeBorder: "#df8e1d",
      contextBg: "#89b4fa",
      contextBorder: "#1e66f5",
      blockedBg: "#f38ba8",
      blockedBorder: "#d20f39",
      strong: getCssVariable(computed, "--text-normal", "#cdd6f4"),
      weak: getCssVariable(computed, "--background-modifier-border", "#bcc0cc"),
    };

    const stylesheet = [
      {
        selector: "core",
        style: {
          "selection-box-color": theme.contextBg,
          "selection-box-opacity": 0.2,
        },
      },
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
      {
        selector: "node.completed",
        style: { "background-color": theme.completedBg, "border-color": theme.completedBorder },
      },
      {
        selector: "node.active",
        style: { "background-color": theme.activeBg, "border-color": theme.activeBorder },
      },
      {
        selector: "node.context",
        style: { "background-color": theme.contextBg, "border-color": theme.contextBorder },
      },
      {
        selector: "node.blocked",
        style: { "background-color": theme.blockedBg, "border-color": theme.blockedBorder },
      },
      { selector: "node.system", style: { shape: "round-rectangle" } },
      { selector: "node.task", style: { shape: "ellipse" } },
      { selector: "node.decision", style: { shape: "diamond", padding: "16px" } },
      {
        selector: "edge",
        style: {
          width: 2.5,
          "line-color": theme.edge,
          "target-arrow-color": theme.edge,
          "target-arrow-shape": "triangle",
          "arrow-scale": 1.1,
          "curve-style": "straight",
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
      {
        selector: "edge.strong-edge",
        style: {
          width: 3.5,
          "line-color": theme.strong,
          "target-arrow-color": theme.strong,
        },
      },
      {
        selector: "edge.weak-edge",
        style: {
          width: 1.5,
          "line-style": "dashed",
          "line-color": theme.weak,
          "target-arrow-color": theme.weak,
        },
      },
    ];

    return stylesheet as cytoscape.StylesheetJson;
  }

  private bindHoverInteractions(): void {
    if (!this.cy) return;

    // Read --interactive-accent inside the mouseover handler (not once at
    // bind time) so the next hover after a theme switch picks up the new
    // accent without needing to rebind handlers from applyTheme().
    this.cy.on("mouseover", "node", (evt) => {
      const highlight = getCssVariable(
        getComputedStyle(this.containerEl),
        "--interactive-accent",
        "#2563eb",
      );
      evt.target.style("border-width", 4);
      evt.target.connectedEdges().style({
        "line-color": highlight,
        "target-arrow-color": highlight,
        width: 5,
      });
    });

    this.cy.on("mouseout", "node", (evt) => {
      evt.target.style("border-width", 2);
      evt.target.connectedEdges().forEach((edge: cytoscape.EdgeSingular) => {
        edge.removeStyle("line-color");
        edge.removeStyle("target-arrow-color");
        edge.removeStyle("width");
      });
    });
  }

  private prepareVisibleContainer(): void {
    this.containerEl.style.display = "";
    this.containerEl.empty();
    this.containerEl.addClass("visual-notes-container");
  }

  private hide(): void {
    this.destroyGraph();
    this.containerEl.empty();
    this.containerEl.style.display = "none";
  }

  private showPlaceholder(message: string): void {
    this.destroyGraph();
    this.prepareVisibleContainer();
    this.containerEl.createDiv({
      cls: "visual-notes-placeholder",
      text: message,
    });
  }

  private destroyGraph(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.refitScheduled = false;
    this.cy?.destroy();
    this.cy = null;
    this.fullscreenBtn = null;
  }

  private removeDuplicateContainersForSource(): void {
    if (!this.removeDuplicates) {
      return;
    }

    Array.from(document.querySelectorAll(".visual-notes-container")).forEach((container) => {
      if (
        container !== this.containerEl &&
        container instanceof HTMLElement &&
        container.dataset.visualNotesSourcePath === this.sourcePath
      ) {
        container.remove();
      }
    });
  }
}

function getCssVariable(computed: CSSStyleDeclaration, name: string, fallback: string): string {
  return computed.getPropertyValue(name).trim() || fallback;
}

function formatTokens(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatTokenSummary(usage: {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}): string {
  return `${formatTokens(usage.totalTokens)} tokens (${formatTokens(usage.inputTokens)} in / ${formatTokens(
    usage.outputTokens,
  )} out)`;
}

function formatUsd(value: number): string {
  if (value < 0.001) {
    return `$${value.toFixed(6)}`;
  }

  if (value < 1) {
    return `$${value.toFixed(4)}`;
  }

  return `$${value.toFixed(2)}`;
}

function formatSourceSummary(sidecar: VisualNotesSidecar): string {
  if (sidecar._sourceContext?.provider === "daily-context") {
    const sourceCount = sidecar._sourceContext.sourceCount;
    return `Source: Daily Context (${sourceCount} source${sourceCount === 1 ? "" : "s"})`;
  }

  if (sidecar._lastProcessedHashKind === "semantic-markdown") {
    return "Source: raw markdown";
  }

  return "Source: unknown";
}
