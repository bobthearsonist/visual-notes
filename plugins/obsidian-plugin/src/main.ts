import {
  debounce,
  Events,
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  normalizePath,
} from "obsidian";
import { AnthropicExtractionError, extractGraphFromAnthropic } from "./extractor";
import { estimateTokens, sha256Hash } from "./hash";
import { sidecarPathForMarkdownPath, VisualNotesRenderChild } from "./renderer";
import { parseSidecar, type VisualNotesSidecar } from "./schema";
import {
  currentLocalDate,
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  VisualNotesSettingTab,
  type VisualNotesSettings,
} from "./settings";
import { addExtractionUsage } from "./usage";

const PRODUCER_ID = "obsidian-plugin@0.1.0";
const MAX_INPUT_TOKENS = 100_000;
const FORCE_REGENERATE_COOLDOWN_MS = 30_000;
const MOUNT_RETRY_LIMIT = 30;
const MOUNT_RETRY_DELAY_MS = 100;

type VisualNotesViewMode = "preview" | "source";

interface ExtractionOptions {
  force: boolean;
  manual: boolean;
}

export default class VisualNotesPlugin extends Plugin {
  settings: VisualNotesSettings = { ...DEFAULT_SETTINGS };
  sidecarEvents = new Events();

  private readonly debounceTimers = new Map<string, DebouncedExtraction>();
  private readonly forceRegenerateCooldowns = new Map<string, number>();
  private readonly pendingMountSourcePaths = new Set<string>();
  private activeRenderChild: VisualNotesRenderChild | null = null;
  private activeRenderSourcePath: string | null = null;
  private activeRenderMode: VisualNotesViewMode | null = null;
  private statusBarEl: HTMLElement | null = null;
  private activeExtractions = 0;

  async onload(): Promise<void> {
    document.querySelectorAll(".visual-notes-container").forEach((container) => container.remove());
    await this.loadSettings();
    this.addSettingTab(new VisualNotesSettingTab(this.app, this));
    this.statusBarEl = this.addStatusBarItem();
    this.updateStatusBar();

    if (this.settings.anthropicApiKey && this.settings.watchedFolders.length === 0) {
      new Notice("Visual Notes: add a watched folder in Settings to enable extraction.");
    }

    await this.noticeMissingWatchedFolders();
    this.registerCommands();
    this.registerMarkdownPostProcessor((el, ctx) => {
      if (!ctx.sourcePath.endsWith(".md")) {
        return;
      }

      this.queueVisualNotesMount(ctx.sourcePath);
    });

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md" && this.isWatchedFile(file)) {
          this.queueExtraction(file);
        }
      }),
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view instanceof MarkdownView && leaf.view.file) {
          this.queueVisualNotesMount(leaf.view.file.path);
          return;
        }

        this.clearActiveRenderChild();
      }),
    );

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.queueVisualNotesMount(file.path);
          return;
        }

        this.clearActiveRenderChild();
      }),
    );

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.queueActiveVisualNotesMount();
      }),
    );
    this.registerInterval(window.setInterval(() => this.queueActiveVisualNotesMount(), 1_000));

    window.setTimeout(() => this.queueActiveVisualNotesMount(), 0);
  }

  onunload(): void {
    this.debounceTimers.forEach((timer) => timer.cancel());
    this.debounceTimers.clear();
    this.pendingMountSourcePaths.clear();
    this.clearActiveRenderChild();
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<VisualNotesSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      _settingsVersion: loaded?._settingsVersion ?? SETTINGS_VERSION,
      watchedFolders: (loaded?.watchedFolders ?? DEFAULT_SETTINGS.watchedFolders)
        .map((folder) => folder.trim())
        .filter(Boolean),
      extractionCounter: loaded?.extractionCounter ?? { date: currentLocalDate(), count: 0 },
    };
  }

  async saveSettings(): Promise<void> {
    this.settings.watchedFolders = this.settings.watchedFolders
      .map((folder) => folder.trim())
      .filter(Boolean);
    await this.saveData(this.settings);
    this.updateStatusBar();
  }

  log(level: "debug" | "warn" | "error", message: string, data?: unknown): void {
    const prefix = `[visual-notes] ${message}`;
    if (data === undefined) {
      console[level](prefix);
      return;
    }

    console[level](prefix, data);
  }

  private registerCommands(): void {
    this.addCommand({
      id: "extract-current-note",
      name: "Extract from current note",
      checkCallback: (checking) => this.withActiveMarkdownFile(checking, (file) =>
        this.extractFile(file, { force: false, manual: true }),
      ),
    });

    this.addCommand({
      id: "regenerate-current-note-force",
      name: "Regenerate (force)",
      checkCallback: (checking) => this.withActiveMarkdownFile(checking, (file) =>
        this.forceRegenerate(file),
      ),
    });

    this.addCommand({
      id: "pin-current-overview",
      name: "Pin this overview",
      checkCallback: (checking) => this.withActiveMarkdownFile(checking, (file) =>
        this.setPinned(file, true),
      ),
    });

    this.addCommand({
      id: "unpin-current-overview",
      name: "Unpin this overview",
      checkCallback: (checking) => this.withActiveMarkdownFile(checking, (file) =>
        this.setPinned(file, false),
      ),
    });

    this.addCommand({
      id: "delete-current-sidecar",
      name: "Delete sidecar",
      checkCallback: (checking) => this.withActiveMarkdownFile(checking, (file) =>
        this.deleteSidecar(file),
      ),
    });
  }

  private queueActiveVisualNotesMount(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile) || activeFile.extension !== "md") {
      this.clearActiveRenderChild();
      return;
    }

    this.queueVisualNotesMount(activeFile.path);
  }

  private queueVisualNotesMount(sourcePath: string): void {
    if (!sourcePath.endsWith(".md")) {
      return;
    }

    if (this.pendingMountSourcePaths.has(sourcePath)) {
      return;
    }

    this.pendingMountSourcePaths.add(sourcePath);
    window.setTimeout(() => {
      this.pendingMountSourcePaths.delete(sourcePath);
      this.mountVisualNotesForSource(sourcePath);
    }, 0);
  }

  private mountVisualNotesForSource(sourcePath: string, attempt = 0): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile) || activeFile.path !== sourcePath) {
      return;
    }

    const leaf = this.getMarkdownLeafForPath(sourcePath);
    if (!leaf || !(leaf.view instanceof MarkdownView)) {
      return;
    }

    const mode = leaf.view.getMode() === "source" ? "source" : "preview";
    const mountTarget = mode === "source" ? findSourceMountTarget(leaf.view) : findPreviewMountTarget(leaf.view);

    if (!(mountTarget instanceof HTMLElement)) {
      if (attempt < MOUNT_RETRY_LIMIT) {
        window.setTimeout(
          () => this.mountVisualNotesForSource(sourcePath, attempt + 1),
          MOUNT_RETRY_DELAY_MS,
        );
      }
      return;
    }

    if (
      this.activeRenderChild &&
      this.activeRenderSourcePath === sourcePath &&
      this.activeRenderMode === mode &&
      this.activeRenderChild.containerEl.parentElement === mountTarget
    ) {
      return;
    }

    this.clearActiveRenderChild();

    document
      .querySelectorAll(`.visual-notes-container[data-visual-notes-source-path="${cssEscape(sourcePath)}"]`)
      .forEach((container) => container.remove());

    const container = document.createElement("div");
    container.classList.add("visual-notes-container", `visual-notes-${mode}-container`);
    container.dataset.visualNotesSourcePath = sourcePath;

    if (mode === "source") {
      const editor = mountTarget.querySelector(".cm-editor");
      mountTarget.insertBefore(container, editor ?? mountTarget.firstChild);
    } else {
      const insertionTarget = findFrontmatterBoundary(mountTarget);
      if (insertionTarget?.nextSibling) {
        mountTarget.insertBefore(container, insertionTarget.nextSibling);
      } else if (insertionTarget) {
        mountTarget.appendChild(container);
      } else {
        mountTarget.prepend(container);
      }
    }

    const child = new VisualNotesRenderChild(container, this, sourcePath);
    this.addChild(child);
    this.activeRenderChild = child;
    this.activeRenderSourcePath = sourcePath;
    this.activeRenderMode = mode;
  }

  private getMarkdownLeafForPath(sourcePath: string) {
    return this.app.workspace
      .getLeavesOfType("markdown")
      .find((candidate) => {
        const view = candidate.view;
        return view instanceof MarkdownView && view.file?.path === sourcePath;
      });
  }

  private clearActiveRenderChild(): void {
    if (this.activeRenderChild) {
      this.removeChild(this.activeRenderChild);
    }

    this.activeRenderChild = null;
    this.activeRenderSourcePath = null;
    this.activeRenderMode = null;
  }

  private withActiveMarkdownFile(
    checking: boolean,
    callback: (file: TFile) => Promise<void>,
  ): boolean {
    const file = this.app.workspace.getActiveFile();
    const isMarkdown = file instanceof TFile && file.extension === "md";
    if (checking) {
      return isMarkdown;
    }

    if (!isMarkdown) {
      new Notice("Visual Notes: open a markdown note first.");
      return false;
    }

    void callback(file);
    return true;
  }

  private queueExtraction(file: TFile): void {
    const existing = this.debounceTimers.get(file.path);
    existing?.cancel();

    const debounced = debounce(
      () => {
        this.debounceTimers.delete(file.path);
        void this.extractFile(file, { force: false, manual: false });
      },
      this.settings.debounceMs,
      true,
    );
    this.debounceTimers.set(file.path, debounced);
    debounced();
  }

  private async extractFile(file: TFile, options: ExtractionOptions): Promise<void> {
    if (!this.settings.anthropicApiKey) {
      new Notice("Visual Notes: add your Anthropic API key in Settings.");
      this.updateStatusBar();
      return;
    }

    if (!options.manual && this.settings.watchedFolders.length === 0) {
      this.updateStatusBar();
      return;
    }

    const markdown = await this.app.vault.read(file);
    const estimatedTokens = estimateTokens(markdown);
    if (estimatedTokens > MAX_INPUT_TOKENS) {
      new Notice(`Visual Notes: note is too large to extract (${estimatedTokens} estimated tokens).`);
      return;
    }

    const hash = await sha256Hash(markdown);
    const sidecarPath = sidecarPathForMarkdownPath(file.path);
    const existingSidecar = await this.readSidecar(sidecarPath);

    if (!options.force) {
      if (existingSidecar?._pinned) {
        if (options.manual) {
          new Notice("Visual Notes: sidecar is pinned — unpin first.");
        }
        return;
      }

      if (existingSidecar?._lastProcessedHash === hash) {
        if (options.manual) {
          new Notice("Visual Notes: current note is already extracted.");
        }
        return;
      }
    }

    this.activeExtractions += 1;
    this.updateStatusBar();

    try {
      const extraction = await extractGraphFromAnthropic({
        apiKey: this.settings.anthropicApiKey,
        model: this.settings.model,
        markdown,
        sourcePath: file.path,
      });
      const extracted = extraction.graph;

      const stamped: VisualNotesSidecar = {
        kind: "daily-overview",
        title: extracted.title ?? titleForFile(file),
        header: extracted.header ?? "Daily Overview",
        subtitle: extracted.subtitle,
        nodes: extracted.nodes,
        edges: extracted.edges,
        _lastProcessedHash: hash,
        _extractedBy: PRODUCER_ID,
        _schemaVersion: SETTINGS_VERSION,
        _pinned: options.force ? false : existingSidecar?._pinned ?? false,
        _usage: extraction.usage
          ? addExtractionUsage(existingSidecar?._usage, extraction.usage)
          : existingSidecar?._usage,
      };

      await this.app.vault.adapter.write(sidecarPath, `${JSON.stringify(stamped, null, 2)}\n`);
      this.sidecarEvents.trigger("changed", sidecarPath);
      this.queueVisualNotesMount(file.path);
      await this.incrementExtractionCounter();

      if (!this.settings.firstRunNoticeShown) {
        this.settings.firstRunNoticeShown = true;
        await this.saveSettings();
        new Notice("Visual Notes: first extraction succeeded. Cost ~$0.006 per save at default model.");
      } else if (options.manual) {
        new Notice("Visual Notes: extraction complete.");
      }
    } catch (error) {
      this.handleExtractionError(error);
    } finally {
      this.activeExtractions -= 1;
      this.updateStatusBar();
    }
  }

  private async forceRegenerate(file: TFile): Promise<void> {
    const now = Date.now();
    const lastRun = this.forceRegenerateCooldowns.get(file.path) ?? 0;
    const remainingMs = FORCE_REGENERATE_COOLDOWN_MS - (now - lastRun);

    if (remainingMs > 0) {
      new Notice(`Visual Notes: regenerate cooldown — wait ${Math.ceil(remainingMs / 1000)}s.`);
      return;
    }

    this.forceRegenerateCooldowns.set(file.path, now);
    await this.extractFile(file, { force: true, manual: true });
  }

  private async setPinned(file: TFile, pinned: boolean): Promise<void> {
    const sidecarPath = sidecarPathForMarkdownPath(file.path);
    const existingSidecar = await this.readSidecar(sidecarPath);

    if (!existingSidecar) {
      new Notice("Visual Notes: no sidecar exists for this note yet.");
      return;
    }

    await this.app.vault.adapter.write(
      sidecarPath,
      `${JSON.stringify({ ...existingSidecar, _pinned: pinned }, null, 2)}\n`,
    );
    this.sidecarEvents.trigger("changed", sidecarPath);
    new Notice(`Visual Notes: overview ${pinned ? "pinned" : "unpinned"}.`);
  }

  private async deleteSidecar(file: TFile): Promise<void> {
    const sidecarPath = sidecarPathForMarkdownPath(file.path);
    if (!(await this.app.vault.adapter.exists(sidecarPath))) {
      new Notice("Visual Notes: no sidecar exists for this note.");
      return;
    }

    await this.app.vault.adapter.remove(sidecarPath);
    this.sidecarEvents.trigger("changed", sidecarPath);
    new Notice("Visual Notes: sidecar deleted — next save will re-extract.");
  }

  private async readSidecar(sidecarPath: string): Promise<VisualNotesSidecar | null> {
    if (!(await this.app.vault.adapter.exists(sidecarPath))) {
      return null;
    }

    const raw = await this.app.vault.adapter.read(sidecarPath);
    return parseSidecar(JSON.parse(raw));
  }

  private isWatchedFile(file: TFile): boolean {
    if (this.settings.watchedFolders.length === 0) {
      return false;
    }

    const filePath = normalizePath(file.path);
    return this.settings.watchedFolders.some((folder) => {
      const normalized = normalizePath(folder).replace(/^\/+|\/+$/g, "");
      return filePath === `${normalized}.md` || filePath.startsWith(`${normalized}/`);
    });
  }

  private async noticeMissingWatchedFolders(): Promise<void> {
    for (const folder of this.settings.watchedFolders) {
      if (!(await this.app.vault.adapter.exists(folder))) {
        new Notice(`Visual Notes: watched folder not found: ${folder}`);
      }
    }
  }

  private async incrementExtractionCounter(): Promise<void> {
    const today = currentLocalDate();
    if (this.settings.extractionCounter.date !== today) {
      this.settings.extractionCounter = { date: today, count: 0 };
    }

    this.settings.extractionCounter.count += 1;
    await this.saveSettings();
  }

  private updateStatusBar(): void {
    if (!this.statusBarEl) {
      return;
    }

    if (!this.settings.anthropicApiKey) {
      this.statusBarEl.setText("Visual Notes: configure API key");
      this.statusBarEl.toggleClass("mod-error", true);
      return;
    }

    if (this.settings.watchedFolders.length === 0) {
      this.statusBarEl.setText("Visual Notes: add watched folder");
      this.statusBarEl.toggleClass("mod-error", true);
      return;
    }

    this.statusBarEl.toggleClass("mod-error", false);
    if (this.activeExtractions > 0) {
      this.statusBarEl.setText("Visual Notes: extracting...");
      return;
    }

    const counter = this.settings.extractionCounter;
    this.statusBarEl.setText(`Visual Notes: ${counter.count} today`);
  }

  private handleExtractionError(error: unknown): void {
    if (error instanceof AnthropicExtractionError) {
      this.log("error", error.message, { status: error.status });
      if (error.status === 401) {
        new Notice("Visual Notes: API key invalid. Open Settings -> Visual Notes.", 8000);
        return;
      }

      new Notice(`Visual Notes: extraction failed (${error.status ?? "network"}). See console.`);
      return;
    }

    this.log("error", "Extraction failed.", error);
    new Notice("Visual Notes: extraction failed. See console.");
  }
}

type DebouncedExtraction = ReturnType<typeof debounce>;

function titleForFile(file: TFile): string {
  return `Daily Overview - ${file.basename}`;
}

function findPreviewMountTarget(view: MarkdownView): HTMLElement | null {
  const section = view.containerEl.querySelector(
    ".markdown-reading-view > .markdown-preview-view > .markdown-preview-sizer.markdown-preview-section",
  );
  return section instanceof HTMLElement ? section : null;
}

function findSourceMountTarget(view: MarkdownView): HTMLElement | null {
  const sourceView = view.containerEl.querySelector(".markdown-source-view");
  return sourceView instanceof HTMLElement ? sourceView : null;
}

function findFrontmatterBoundary(section: HTMLElement): Element | null {
  const directChildren = Array.from(section.children);
  const frontmatter = directChildren.find((child) =>
    child.classList.contains("mod-header") ||
    child.classList.contains("mod-frontmatter") ||
    child.querySelector(".metadata-container") !== null,
  );
  if (frontmatter) {
    return frontmatter;
  }

  return directChildren.find((child) => child.classList.contains("markdown-preview-pusher")) ?? null;
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
