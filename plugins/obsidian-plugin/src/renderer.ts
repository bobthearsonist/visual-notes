import cytoscape from "cytoscape";
import { EventRef, MarkdownRenderChild, normalizePath } from "obsidian";
import type VisualNotesPlugin from "./main";
import { parseSidecar, type VisualNotesSidecar } from "./schema";

export function sidecarPathForMarkdownPath(path: string): string {
  return normalizePath(path.replace(/\.md$/i, "") + "-overview.json");
}

export class VisualNotesRenderChild extends MarkdownRenderChild {
  private cy: cytoscape.Core | null = null;
  private sidecarEventRef: EventRef | null = null;
  private readonly sidecarPath: string;

  constructor(
    containerEl: HTMLElement,
    private readonly plugin: VisualNotesPlugin,
    sourcePath: string,
  ) {
    super(containerEl);
    this.sidecarPath = sidecarPathForMarkdownPath(sourcePath);
  }

  onload(): void {
    this.moveContainerToPreviewSection();
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
    this.destroyGraph();
    this.sidecarEventRef = null;
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
    this.destroyGraph();
    this.prepareVisibleContainer();

    const header = this.containerEl.createDiv({ cls: "visual-notes-header" });
    header.createDiv({
      cls: "visual-notes-title",
      text: sidecar.header ?? sidecar.title ?? "Daily Overview",
    });

    if (sidecar.subtitle) {
      header.createDiv({ cls: "visual-notes-subtitle", text: sidecar.subtitle });
    }

    const graphEl = this.containerEl.createDiv({ cls: "visual-notes-graph" });
    const elements: cytoscape.ElementDefinition[] = [
      ...sidecar.nodes.map((node) => ({
        group: "nodes" as const,
        data: node.data,
        classes: node.classes ?? "",
        position: node.position,
      })),
      ...sidecar.edges.map((edge) => ({
        group: "edges" as const,
        data: edge.data,
        classes: edge.classes ?? "",
      })),
    ];

    this.cy = cytoscape({
      container: graphEl,
      elements,
      layout: { name: "preset", fit: true, padding: 40 },
      style: this.createStyle(),
      minZoom: 0.3,
      maxZoom: 3,
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
          label: "data(label)",
          "font-family": "sans-serif",
          "font-size": 13,
          "font-weight": 600,
          "text-valign": "center",
          "text-halign": "center",
          "text-wrap": "wrap",
          "text-max-width": "120px",
          height: 64,
          width: 128,
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
        selector: "edge",
        style: {
          width: 2,
          "line-color": theme.edge,
          "target-arrow-color": theme.edge,
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
          color: theme.muted,
          label: "data(label)",
          "font-size": 11,
          "font-family": "sans-serif",
          "text-background-color": theme.background,
          "text-background-opacity": 0.85,
          "text-background-padding": "3px",
          "text-rotation": "autorotate",
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

  private moveContainerToPreviewSection(): void {
    const section = this.containerEl.closest(".markdown-preview-section");
    if (section instanceof HTMLElement && this.containerEl.parentElement !== section) {
      section.prepend(this.containerEl);
    }
  }
}

function getCssVariable(computed: CSSStyleDeclaration, name: string, fallback: string): string {
  return computed.getPropertyValue(name).trim() || fallback;
}
