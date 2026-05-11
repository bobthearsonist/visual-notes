import type { VisualNotesProcessedHashKind, VisualNotesSourceContext } from "./schema";
import type { MarkdownSectionSummary } from "./sections";

const DAILY_CONTEXT_PLUGIN_ID = "daily-context";
const SUPPORTED_DAILY_CONTEXT_API_VERSION = 1;
const MAX_SOURCE_CONTEXT_ENTRIES = 200;

export interface DailyContextApi {
  version: number;
  getDailyContext(date: string, options?: DailyContextRequestOptions): Promise<DailyContext>;
}

export interface DailyContextRequestOptions {
  contextId?: string;
  dailyPath?: string;
  include?: DailyContextSourceKind[];
  maxSourceBytes?: number;
}

export type DailyContextSourceKind =
  | "daily-prelude"
  | "daily-section"
  | "ai-session"
  | "date-tagged-file";

export interface DailyContext {
  schemaVersion: number;
  parserVersion: number;
  generatedAt: string;
  date: string;
  dateTag: string;
  contextHash: string;
  contexts: DailyContextGroup[];
  sources: DailyContextSource[];
}

export interface DailyContextGroup {
  id: string;
  dailyFolder: string;
  sessionFolder: string;
}

export interface DailyContextSource {
  id: string;
  kind: DailyContextSourceKind;
  path: string;
  label: string;
  hash: string;
  content?: string;
  sections?: DailyContextSection[];
  metadata?: Record<string, unknown>;
}

export interface DailyContextSection {
  heading: string;
  level: number;
  hash: string;
  content: string;
}

export interface PreparedDailyContextExtraction {
  markdown: string;
  sections: MarkdownSectionSummary[];
  processedHash: string;
  processedHashKind: VisualNotesProcessedHashKind;
  sourceContext: VisualNotesSourceContext;
}

export function getDailyContextApi(app: unknown): DailyContextApi | null {
  const appRecord = recordFrom(app);
  const pluginsRecord = recordFrom(appRecord?.plugins);
  const loadedPlugins = recordFrom(pluginsRecord?.plugins);
  const plugin = recordFrom(loadedPlugins?.[DAILY_CONTEXT_PLUGIN_ID]);
  const api = recordFrom(plugin?.api);

  if (
    api?.version !== SUPPORTED_DAILY_CONTEXT_API_VERSION ||
    typeof api.getDailyContext !== "function"
  ) {
    return null;
  }

  return {
    version: api.version,
    getDailyContext: api.getDailyContext.bind(api) as DailyContextApi["getDailyContext"],
  };
}

export function normalizeDailyContextDateFromPath(path: string): string | null {
  const normalizedPath = path.replace(/\\/g, "/");
  const basename = normalizedPath.split("/").pop()?.replace(/\.md$/iu, "") ?? normalizedPath;
  return normalizeDateMatch(basename) ?? normalizeDateMatch(normalizedPath);
}

export function buildDailyContextExtractionInput(
  context: DailyContext,
): PreparedDailyContextExtraction | null {
  const sources = context.sources
    .filter((source) => typeof source.content === "string" && source.content.trim().length > 0)
    .sort(compareSources)
    .slice(0, MAX_SOURCE_CONTEXT_ENTRIES);

  if (sources.length === 0) {
    return null;
  }

  const lines = [
    `# Daily Context ${context.date}`,
    "",
    `Date tag: ${context.dateTag}`,
    `Context hash: ${context.contextHash}`,
    "",
  ];
  const sections: MarkdownSectionSummary[] = [];
  const usedSectionIds = new Set<string>();

  sources.forEach((source, index) => {
    const sectionId = uniqueSlug(slugify(`dc-${source.kind}-${source.id}`), usedSectionIds);
    const heading = `${source.kind}: ${source.label}`;
    const sourceContent = normalizeSourceContent(source.content ?? "");
    const startLine = lines.length + 1;

    lines.push(
      `## ${heading}`,
      "",
      `Source ID: ${source.id}`,
      `Source kind: ${source.kind}`,
      `Source path: ${source.path}`,
      `Source hash: ${source.hash}`,
      `Section ID: ${sectionId}`,
    );

    if (source.sections && source.sections.length > 0) {
      lines.push(
        "Source sections:",
        ...source.sections.map((section) => `- ${section.heading} (${section.hash})`),
      );
    }

    lines.push("", ...sourceContent.split("\n"), "");

    sections.push({
      id: sectionId,
      title: heading,
      level: 2,
      ordinal: index,
      startLine,
      endLine: Math.max(startLine, lines.length - 1),
      hash: source.hash,
    });
  });

  return {
    markdown: `${lines.join("\n").trimEnd()}\n`,
    sections,
    processedHash: context.contextHash,
    processedHashKind: "daily-context",
    sourceContext: {
      provider: "daily-context",
      apiVersion: SUPPORTED_DAILY_CONTEXT_API_VERSION,
      schemaVersion: context.schemaVersion,
      parserVersion: context.parserVersion,
      contextHash: context.contextHash,
      generatedAt: context.generatedAt,
      sourceCount: sources.length,
      sources: sources.map((source) => ({
        id: source.id,
        kind: source.kind,
        path: source.path,
        label: source.label,
        hash: source.hash,
      })),
    },
  };
}

export function isExtractionCurrent(options: {
  existingHash: string | undefined;
  existingHashKind: VisualNotesProcessedHashKind | undefined;
  processedHash: string;
  processedHashKind: VisualNotesProcessedHashKind;
  rawHash: string;
}): boolean {
  if (!options.existingHash) {
    return false;
  }

  if (options.existingHashKind) {
    return (
      options.existingHashKind === options.processedHashKind &&
      options.existingHash === options.processedHash
    );
  }

  if (options.processedHashKind === "semantic-markdown") {
    return options.existingHash === options.processedHash || options.existingHash === options.rawHash;
  }

  return false;
}

function compareSources(left: DailyContextSource, right: DailyContextSource): number {
  return `${left.kind}:${left.path}:${left.id}`.localeCompare(`${right.kind}:${right.path}:${right.id}`);
}

function normalizeSourceContent(content: string): string {
  return content.trim().replace(/\r\n?/g, "\n");
}

function normalizeDateMatch(value: string): string | null {
  const dashed = value.match(/(?:^|[^\d])(\d{4})-(\d{2})-(\d{2})(?:[^\d]|$)/u);
  if (dashed) {
    return `${dashed[1]}-${dashed[2]}-${dashed[3]}`;
  }

  const compact = value.match(/(?:^|[^\d])(\d{4})(\d{2})(\d{2})(?:[^\d]|$)/u);
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }

  return null;
}

function uniqueSlug(baseSlug: string, used: Set<string>): string {
  const fallback = baseSlug || "dc-source";
  let slug = fallback;
  let suffix = 2;
  while (used.has(slug)) {
    slug = `${fallback}-${suffix}`;
    suffix += 1;
  }
  used.add(slug);
  return slug;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}
