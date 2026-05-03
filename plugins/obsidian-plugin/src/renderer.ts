import cytoscape from "cytoscape";
import { EventRef, MarkdownRenderChild, normalizePath } from "obsidian";
import type VisualNotesPlugin from "./main";
import { parseSidecar, type VisualNotesEdge, type VisualNotesNode, type VisualNotesSidecar } from "./schema";

export function sidecarPathForMarkdownPath(path: string): string {
  return normalizePath(path.replace(/\.md$/i, "") + "-overview.json");
}

export class VisualNotesRenderChild extends MarkdownRenderChild {
  private cy: cytoscape.Core | null = null;
  private sidecarEventRef: EventRef | null = null;
  private readonly sidecarPath: string;
  private readonly sourcePath: string;

  constructor(
    containerEl: HTMLElement,
    private readonly plugin: VisualNotesPlugin,
    sourcePath: string,
  ) {
    super(containerEl);
    this.sourcePath = sourcePath;
    this.sidecarPath = sidecarPathForMarkdownPath(sourcePath);
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
    void this.render();
  }

  onunload(): void {
    const previewRoot = this.containerEl.closest(".markdown-preview-view");
    this.destroyGraph();
    if (
      previewRoot instanceof HTMLElement &&
      previewRoot.dataset.visualNotesSourcePath === this.sourcePath
    ) {
      delete previewRoot.dataset.visualNotesSourcePath;
    }
    this.containerEl.remove();
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

      if (sidecar.kind && sidecar.kind !== "daily-overview") {
        this.plugin.log("warn", `Unsupported sidecar kind '${sidecar.kind}'.`, {
          sidecarPath: this.sidecarPath,
        });
        this.showPlaceholder(`Visual Notes: unsupported sidecar kind '${sidecar.kind}'.`);
        return;
      }

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

    const graphEl = this.containerEl.createDiv({ cls: "visual-notes-graph" });
    const positionById = new Map(sidecar.nodes.map((node) => [node.data.id, node.position]));
    const storyGroups = buildStoryGroups(sidecar.nodes, sidecar.edges);
    const storyGroupByNodeId = new Map(
      storyGroups.flatMap((group) => group.nodeIds.map((nodeId): [string, string] => [nodeId, group.id])),
    );
    const elements: cytoscape.ElementDefinition[] = [
      ...storyGroups.map((group) => ({
        group: "nodes" as const,
        data: {
          id: group.id,
          label: group.label,
          displayLabel: group.label,
        },
        classes: "story-card",
      })),
      ...sidecar.nodes.map((node) => ({
        group: "nodes" as const,
        data: {
          ...node.data,
          displayLabel: node.data.label,
          parent: storyGroupByNodeId.get(node.data.id),
        },
        classes: node.classes ?? "",
        position: node.position,
      })),
      ...sidecar.edges.map((edge) => ({
        group: "edges" as const,
        data: {
          ...edge.data,
          displayLabel: edgeDisplayLabel(edge, positionById),
        },
        classes: edge.classes ?? "",
      })),
    ];

    this.cy = cytoscape({
      container: graphEl,
      elements,
      layout: { name: "preset", fit: true, padding: 26 },
      style: this.createStyle(),
      minZoom: 0.3,
      maxZoom: 3,
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

  private applyTheme(): void {
    if (!this.cy) {
      return;
    }

    this.cy.style().fromJson(this.createStyle()).update();
  }

  private createStyle(): cytoscape.StylesheetJson {
    const computed = getComputedStyle(this.containerEl);
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
          "font-size": 17,
          "font-weight": 600,
          "text-valign": "center",
          "text-halign": "center",
          "text-wrap": "wrap",
          "text-max-width": "158px",
          height: 84,
          width: 172,
          padding: "12px",
          shape: "round-rectangle",
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
      { selector: "node.decision", style: { shape: "diamond", width: 112, height: 112 } },
      {
        selector: "node.story-card",
        style: {
          shape: "round-rectangle",
          "background-color": getCssVariable(computed, "--background-secondary", "#313244"),
          "background-opacity": 0.32,
          "border-color": theme.border,
          "border-width": 1,
          "border-style": "dashed",
          color: theme.muted,
          label: "",
          "font-family": "sans-serif",
          "font-size": 13,
          "font-weight": 700,
          "text-halign": "left",
          "text-valign": "top",
          "text-margin-x": 12,
          "text-margin-y": 8,
          padding: "28px",
          "z-compound-depth": "bottom",
        },
      },
      {
        selector: "edge",
        style: {
          width: 2,
          "line-color": theme.edge,
          "target-arrow-color": theme.edge,
          "target-arrow-shape": "triangle",
          "curve-style": "taxi",
          "taxi-direction": "auto",
          "taxi-turn": "50%",
          color: theme.muted,
          label: "data(displayLabel)",
          "font-size": 13,
          "font-family": "sans-serif",
          "text-background-color": theme.background,
          "text-background-opacity": 0.85,
          "text-background-padding": "3px",
          "text-rotation": "none",
        },
      },
      {
        selector: "edge.strong-edge",
        style: {
          width: 3,
          "line-color": theme.strong,
          "target-arrow-color": theme.strong,
        },
      },
      {
        selector: "edge.weak-edge",
        style: {
          width: 1,
          opacity: 0.34,
          label: "",
          "line-style": "dashed",
          "line-color": theme.weak,
          "target-arrow-color": theme.weak,
        },
      },
    ];

    return stylesheet as cytoscape.StylesheetJson;
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
    this.cy?.destroy();
    this.cy = null;
  }

  private removeDuplicateContainersForSource(): void {
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

function edgeDisplayLabel(
  edge: VisualNotesSidecar["edges"][number],
  positionById: Map<string, { x: number; y: number }>,
): string {
  if (edge.classes === "weak-edge") {
    return "";
  }

  const source = positionById.get(edge.data.source);
  const target = positionById.get(edge.data.target);
  if (!source || !target) {
    return edge.data.label;
  }

  const edgeLength = Math.hypot(source.x - target.x, source.y - target.y);
  return edgeLength <= 380 ? edge.data.label : "";
}

function buildStoryGroups(
  nodes: VisualNotesNode[],
  edges: VisualNotesEdge[],
): Array<{ id: string; label: string; nodeIds: string[] }> {
  const primaryEdges = edges.filter((edge) => edge.classes !== "weak-edge");
  const ids = nodes.map((node) => node.data.id);
  const idSet = new Set(ids);
  const parentById = new Map(ids.map((id): [string, string] => [id, id]));

  primaryEdges.forEach((edge) => {
    if (idSet.has(edge.data.source) && idSet.has(edge.data.target)) {
      union(parentById, edge.data.source, edge.data.target);
    }
  });

  const nodesByRoot = new Map<string, VisualNotesNode[]>();
  nodes.forEach((node) => {
    const root = find(parentById, node.data.id);
    const groupNodes = nodesByRoot.get(root) ?? [];
    groupNodes.push(node);
    nodesByRoot.set(root, groupNodes);
  });

  return Array.from(nodesByRoot.values())
    .reduce<VisualNotesNode[][]>((groups, groupNodes) => {
      if (groupNodes.length > 1) {
        groups.push(groupNodes);
        return groups;
      }

      const singletonGroup = groups.find((group) => group.length > 0 && group[0]?.data.id === "__singletons__");
      if (singletonGroup) {
        singletonGroup.push(groupNodes[0]);
      } else {
        groups.push([
          {
            ...groupNodes[0],
            data: { id: "__singletons__", label: "Cross-cutting\ninsights" },
          },
          groupNodes[0],
        ]);
      }

      return groups;
    }, [])
    .map((groupNodes) =>
      groupNodes[0]?.data.id === "__singletons__" ? groupNodes.slice(1) : groupNodes,
    )
    .filter((groupNodes) => groupNodes.length > 1)
    .sort((left, right) => {
      const leftPosition = groupTopLeft(left);
      const rightPosition = groupTopLeft(right);
      return leftPosition.y - rightPosition.y || leftPosition.x - rightPosition.x;
    })
    .map((groupNodes, index) => {
      const anchor = selectStoryGroupAnchor(groupNodes);
      return {
        id: `story-card-${index + 1}`,
        label: isSingletonStory(groupNodes, primaryEdges)
          ? `Story ${index + 1}: Cross-cutting insights`
          : `Story ${index + 1}: ${firstLabelLine(anchor.data.label)}`,
        nodeIds: groupNodes.map((node) => node.data.id),
      };
    });
}

function isSingletonStory(nodes: VisualNotesNode[], primaryEdges: VisualNotesSidecar["edges"]): boolean {
  const ids = new Set(nodes.map((node) => node.data.id));
  return primaryEdges.every((edge) => !ids.has(edge.data.source) || !ids.has(edge.data.target));
}

function selectStoryGroupAnchor(nodes: VisualNotesNode[]): VisualNotesNode {
  return (
    [...nodes]
      .filter((node) => node.classes.startsWith("system "))
      .sort((left, right) => left.position.y - right.position.y || left.position.x - right.position.x)[0] ??
    [...nodes].sort((left, right) => left.position.y - right.position.y || left.position.x - right.position.x)[0]
  );
}

function groupTopLeft(nodes: VisualNotesNode[]): { x: number; y: number } {
  return {
    x: Math.min(...nodes.map((node) => node.position.x)),
    y: Math.min(...nodes.map((node) => node.position.y)),
  };
}

function firstLabelLine(label: string): string {
  return label.split("\n")[0].replace(/\s+/g, " ").slice(0, 34);
}

function find(parentById: Map<string, string>, id: string): string {
  const parent = parentById.get(id);
  if (!parent || parent === id) {
    return id;
  }

  const root = find(parentById, parent);
  parentById.set(id, root);
  return root;
}

function union(parentById: Map<string, string>, left: string, right: string): void {
  const leftRoot = find(parentById, left);
  const rightRoot = find(parentById, right);

  if (leftRoot !== rightRoot) {
    parentById.set(rightRoot, leftRoot);
  }
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
