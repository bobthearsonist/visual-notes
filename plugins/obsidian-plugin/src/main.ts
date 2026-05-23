import {
  debounce,
  Events,
  Notice,
  Plugin,
  TFile,
  normalizePath,
  type MarkdownPostProcessorContext,
} from "obsidian";
import {
  buildDailyContextExtractionInput,
  getDailyContextApi,
  isExtractionCurrent,
  normalizeDailyContextDateFromPath,
  type PreparedDailyContextExtraction,
} from "./daily-context";
import { validateAnthropicApiKey } from "./anthropic";
import { AnthropicExtractionError, extractGraphFromAnthropic } from "./extractor";
import { estimateTokens, hashMarkdownSections, semanticMarkdownHash, sha256Hash } from "./hash";
import { applyDeterministicLayout } from "./layout";
import { sidecarPathForMarkdownPath, VisualNotesRenderChild } from "./renderer";
import { mergeSectionedGraph } from "./sectioned-sidecar";
import {
  parseSidecar,
  type VisualNotesExtractionHistoryEntry,
  type VisualNotesExtractionReason,
  type VisualNotesProcessedHashKind,
  type VisualNotesSourceContext,
  type VisualNotesSidecar,
} from "./schema";
import type { MarkdownSectionSummary } from "./sections";
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

type ExtractionSourceMode = "auto" | "daily-context";

interface ExtractionOptions {
  force: boolean;
  manual: boolean;
  sourceMode?: ExtractionSourceMode;
}

interface PreparedExtractionInput {
  markdown: string;
  sections: MarkdownSectionSummary[];
  processedHash: string;
  processedHashKind: VisualNotesProcessedHashKind;
  rawHash: string;
  sourceContext?: VisualNotesSourceContext;
}

export default class VisualNotesPlugin extends Plugin {
  settings: VisualNotesSettings = { ...DEFAULT_SETTINGS };
  sidecarEvents = new Events();

  private readonly debounceTimers = new Map<string, DebouncedExtraction>();
  private readonly forceRegenerateCooldowns = new Map<string, number>();
  private readonly activeExtractionPaths = new Set<string>();
  private readonly pendingExtractionPaths = new Set<string>();
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
    this.registerMarkdownCodeBlockProcessor("visual-notes", (_source, el, ctx) => {
      this.mountVisualNotesCodeBlock(el, ctx);
    });

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md" && this.isWatchedFile(file)) {
          this.queueExtraction(file);
        }
      }),
    );
  }

  private mountVisualNotesCodeBlock(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    if (!ctx.sourcePath.endsWith(".md")) {
      return;
    }

    const existingContainer = el.querySelector(".visual-notes-codeblock-container");
    if (existingContainer instanceof HTMLElement) {
      return;
    }

    try {
      const container = document.createElement("div");
      container.classList.add("visual-notes-container", "visual-notes-codeblock-container");
      container.dataset.visualNotesSourcePath = ctx.sourcePath;
      // Build the render child BEFORE we mutate `el`, so a constructor failure
      // doesn't leave the codeblock wiped.
      const child = new VisualNotesRenderChild(container, this, ctx.sourcePath, {
        removeContainerOnUnload: false,
        removeDuplicates: false,
      });
      el.replaceChildren(container);
      el.classList.add("visual-notes-codeblock-host");
      ctx.addChild(child);
    } catch (error) {
      this.log("error", "Failed to mount visual-notes code block.", { sourcePath: ctx.sourcePath, error });
    }
  }

  onunload(): void {
    this.debounceTimers.forEach((timer) => timer.cancel());
    this.debounceTimers.clear();
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
      useDailyContext: loaded?.useDailyContext ?? DEFAULT_SETTINGS.useDailyContext,
      dailyContextId: loaded?.dailyContextId?.trim() ?? DEFAULT_SETTINGS.dailyContextId,
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
      id: "extract-current-note-daily-context",
      name: "Extract from current note using Daily Context",
      checkCallback: (checking) => this.withDailyContextMarkdownFile(checking, (file) =>
        this.extractFile(file, { force: false, manual: true, sourceMode: "daily-context" }),
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

  private withDailyContextMarkdownFile(
    checking: boolean,
    callback: (file: TFile) => Promise<void>,
  ): boolean {
    const file = this.app.workspace.getActiveFile();
    const isMarkdown = file instanceof TFile && file.extension === "md";
    const hasDailyContext = getDailyContextApi(this.app) !== null;
    const hasDate = isMarkdown ? normalizeDailyContextDateFromPath(file.path) !== null : false;

    if (checking) {
      return isMarkdown && hasDailyContext && hasDate;
    }

    if (!isMarkdown) {
      new Notice("Visual Notes: open a markdown daily note first.");
      return false;
    }

    if (!hasDailyContext) {
      new Notice("Visual Notes: Daily Context plugin API is not available.");
      return false;
    }

    if (!hasDate) {
      new Notice("Visual Notes: current note name does not contain a Daily Context date.");
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
    const apiKeyProblem = validateAnthropicApiKey(this.settings.anthropicApiKey);
    if (apiKeyProblem) {
      new Notice(`Visual Notes: ${apiKeyProblem}`, 8000);
      this.updateStatusBar();
      return;
    }

    if (!options.manual && this.settings.watchedFolders.length === 0) {
      this.updateStatusBar();
      return;
    }

    if (this.activeExtractionPaths.has(file.path)) {
      if (options.manual || options.force) {
        new Notice("Visual Notes: extraction is already running for this note.");
      } else {
        this.pendingExtractionPaths.add(file.path);
      }
      return;
    }

    this.activeExtractionPaths.add(file.path);
    this.activeExtractions += 1;
    this.updateStatusBar();

    try {
      const rawMarkdown = await this.app.vault.read(file);
      const extractionInput = await this.prepareExtractionInput(file, rawMarkdown, options);
      if (!extractionInput) {
        return;
      }
      const estimatedTokens = estimateTokens(extractionInput.markdown);
      if (estimatedTokens > MAX_INPUT_TOKENS) {
        new Notice(`Visual Notes: note is too large to extract (${estimatedTokens} estimated tokens).`);
        return;
      }

      const sidecarPath = sidecarPathForMarkdownPath(file.path);
      const existingSidecar = await this.readSidecarForExtraction(sidecarPath, options);

      if (!options.force) {
        if (existingSidecar?._pinned) {
          if (options.manual) {
            new Notice("Visual Notes: sidecar is pinned — unpin first.");
          }
          return;
        }

        if (
          isExtractionCurrent({
            existingHash: existingSidecar?._lastProcessedHash,
            existingHashKind: existingSidecar?._lastProcessedHashKind,
            processedHash: extractionInput.processedHash,
            processedHashKind: extractionInput.processedHashKind,
            rawHash: extractionInput.rawHash,
          })
        ) {
          if (options.manual) {
            new Notice("Visual Notes: current note is already extracted.");
          }
          return;
        }
      }

      const extractionReason = extractionReasonFor(existingSidecar, options);

      const extraction = await extractGraphFromAnthropic({
        apiKey: this.settings.anthropicApiKey,
        model: this.settings.model,
        markdown: extractionInput.markdown,
        sections: extractionInput.sections,
        sourcePath: file.path,
      });
      const extracted = extraction.graph;
      const sectionedGraph = mergeSectionedGraph({
        extracted,
        existing: existingSidecar,
        sections: extractionInput.sections,
        force: options.force,
      });

      const stamped: VisualNotesSidecar = applyDeterministicLayout({
        kind: "daily-overview",
        title: extracted.title ?? titleForFile(file),
        header: extracted.header ?? "Daily Overview",
        subtitle: extracted.subtitle,
        nodes: sectionedGraph.nodes,
        edges: sectionedGraph.edges,
        _sections: sectionedGraph.sections,
        _lastProcessedHash: extractionInput.processedHash,
        _lastProcessedHashKind: extractionInput.processedHashKind,
        _lastRawContentHash: extractionInput.rawHash,
        _lastExtractionReason: extractionReason,
        _sourceContext: extractionInput.sourceContext,
        _extractionHistory: appendExtractionHistory(existingSidecar, {
          at: new Date().toISOString(),
          reason: extractionReason,
          semanticHash: extractionInput.processedHash,
          processedHashKind: extractionInput.processedHashKind,
          rawHash: extractionInput.rawHash,
          inputTokens: extraction.usage?.inputTokens,
          outputTokens: extraction.usage?.outputTokens,
          totalTokens: extraction.usage?.totalTokens,
          estimatedCostUsd: extraction.usage?.estimatedCostUsd,
        }),
        _extractedBy: PRODUCER_ID,
        _schemaVersion: SETTINGS_VERSION,
        _pinned: options.force ? false : existingSidecar?._pinned ?? false,
        _usage: extraction.usage
          ? addExtractionUsage(existingSidecar?._usage, extraction.usage)
          : existingSidecar?._usage,
      });

      await this.app.vault.adapter.write(sidecarPath, `${JSON.stringify(stamped, null, 2)}\n`);
      this.sidecarEvents.trigger("changed", sidecarPath);

      const shouldShowFirstRunNotice = !this.settings.firstRunNoticeShown;
      if (shouldShowFirstRunNotice) {
        this.settings.firstRunNoticeShown = true;
      }
      await this.incrementExtractionCounter();

      if (shouldShowFirstRunNotice) {
        new Notice("Visual Notes: first extraction succeeded. Cost ~$0.006 per save at default model.");
      } else if (options.manual) {
        new Notice("Visual Notes: extraction complete.");
      }
    } catch (error) {
      this.handleExtractionError(error);
    } finally {
      this.activeExtractionPaths.delete(file.path);
      this.activeExtractions -= 1;
      this.updateStatusBar();
      if (this.pendingExtractionPaths.delete(file.path)) {
        this.queueExtraction(file);
      }
    }
  }

  private async prepareExtractionInput(
    file: TFile,
    rawMarkdown: string,
    options: ExtractionOptions,
  ): Promise<PreparedExtractionInput | null> {
    const rawHash = await sha256Hash(rawMarkdown);
    const sourceMode = options.sourceMode ?? "auto";
    const dailyContext = await this.prepareDailyContextExtraction(file, sourceMode);
    if (dailyContext) {
      return {
        ...dailyContext,
        rawHash,
      };
    }

    if (sourceMode === "daily-context") {
      return null;
    }

    const [semanticHash, sections] = await Promise.all([
      semanticMarkdownHash(rawMarkdown),
      hashMarkdownSections(rawMarkdown),
    ]);

    return {
      markdown: rawMarkdown,
      sections,
      processedHash: semanticHash,
      processedHashKind: "semantic-markdown",
      rawHash,
    };
  }

  private async prepareDailyContextExtraction(
    file: TFile,
    sourceMode: "auto" | "daily-context",
  ): Promise<PreparedDailyContextExtraction | null> {
    const requiresDailyContext = sourceMode === "daily-context";
    if (sourceMode === "auto" && !this.settings.useDailyContext) {
      return null;
    }

    const api = getDailyContextApi(this.app);
    if (!api) {
      if (requiresDailyContext) {
        new Notice("Visual Notes: Daily Context plugin API is not available.");
      }
      return null;
    }

    const date = normalizeDailyContextDateFromPath(file.path);
    if (!date) {
      if (requiresDailyContext) {
        new Notice("Visual Notes: current note name does not contain a Daily Context date.");
      }
      return null;
    }

    try {
      const context = await api.getDailyContext(date, {
        dailyPath: file.path,
        contextId: this.settings.dailyContextId || undefined,
      });
      const extractionInput = buildDailyContextExtractionInput(context);
      if (!extractionInput && requiresDailyContext) {
        new Notice("Visual Notes: Daily Context returned no usable source content.");
      }
      return extractionInput;
    } catch (error) {
      this.log("warn", "Daily Context extraction source failed; falling back to raw note.", error);
      new Notice(
        requiresDailyContext
          ? "Visual Notes: Daily Context extraction failed. See console."
          : "Visual Notes: Daily Context failed; falling back to raw note. See console.",
      );
      return null;
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

  private async readSidecarForExtraction(
    sidecarPath: string,
    options: ExtractionOptions,
  ): Promise<VisualNotesSidecar | null> {
    try {
      return await this.readSidecar(sidecarPath);
    } catch (error) {
      this.log("warn", "Existing sidecar is malformed; regenerating.", { sidecarPath, error });
      if (options.manual) {
        new Notice("Visual Notes: existing sidecar is malformed — regenerating.");
      }
      return null;
    }
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

    if (validateAnthropicApiKey(this.settings.anthropicApiKey)) {
      this.statusBarEl.setText("Visual Notes: check API key");
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
      this.log("error", error.message, {
        status: error.status,
        failureKind: error.failureKind,
        retryAfter: error.retryAfter,
      });
      switch (error.failureKind) {
        case "authentication":
          new Notice("Visual Notes: API key invalid. Open Settings -> Visual Notes.", 8000);
          return;
        case "rate-limit": {
          const retryText = error.retryAfter ? ` Try again in ~${error.retryAfter}s.` : "";
          new Notice(`Visual Notes: Anthropic rate limit hit.${retryText}`, 8000);
          return;
        }
        case "usage-limit":
          new Notice("Visual Notes: Anthropic API usage limit reached. Check billing/limits.", 8000);
          return;
        case "input-too-large":
          new Notice("Visual Notes: extraction input is too large. Narrow Daily Context or split the note.", 8000);
          return;
        case "output-too-large":
          new Notice("Visual Notes: graph response hit the output token limit. Split the note or reduce scope.", 8000);
          return;
        case "bad-request":
          new Notice("Visual Notes: Anthropic rejected the request. Check model/settings; see console.", 8000);
          return;
        case "server":
          new Notice("Visual Notes: Anthropic service error. Try again later.", 8000);
          return;
        case "unknown":
          new Notice(`Visual Notes: extraction failed (${error.status ?? "network"}). See console.`);
          return;
      }
    }

    this.log("error", "Extraction failed.", error);
    new Notice("Visual Notes: extraction failed. See console.");
  }
}

type DebouncedExtraction = ReturnType<typeof debounce>;

function titleForFile(file: TFile): string {
  return `Daily Overview - ${file.basename}`;
}

function extractionReasonFor(
  existingSidecar: VisualNotesSidecar | null,
  options: ExtractionOptions,
): VisualNotesExtractionReason {
  if (options.force) {
    return "force-regenerate";
  }

  if (options.manual) {
    return "manual-extraction";
  }

  return existingSidecar ? "semantic-content-changed" : "first-extraction";
}

function appendExtractionHistory(
  existingSidecar: VisualNotesSidecar | null,
  entry: VisualNotesExtractionHistoryEntry,
): VisualNotesExtractionHistoryEntry[] {
  return [...(existingSidecar?._extractionHistory ?? []), entry].slice(-10);
}

