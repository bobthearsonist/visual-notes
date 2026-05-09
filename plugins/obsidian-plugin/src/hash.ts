import { parseMarkdownSections, type MarkdownSectionSummary } from "./sections";

const VOLATILE_FRONTMATTER_KEYS = new Set([
  "modified",
  "updated",
  "last-modified",
  "lastmod",
  "date-modified",
]);

export async function sha256Hash(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = Array.from(new Uint8Array(digest));
  return `sha256:${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function semanticMarkdownHash(markdown: string): Promise<string> {
  return sha256Hash(normalizeMarkdownForExtractionHash(markdown));
}

export function normalizeMarkdownForExtractionHash(markdown: string): string {
  const lines = markdown.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter((line) => line.length > 0) ?? [];
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return markdown;
  }

  const frontmatterEndIndex = lines.findIndex((line, index) => index > 0 && ["---", "..."].includes(line.trim()));
  if (frontmatterEndIndex === -1) {
    return markdown;
  }

  return lines
    .filter((line, index) => {
      if (index === 0 || index >= frontmatterEndIndex) {
        return true;
      }
      return !isVolatileFrontmatterLine(line);
    })
    .join("");
}

export async function hashMarkdownSections(markdown: string): Promise<MarkdownSectionSummary[]> {
  const sections = parseMarkdownSections(markdown);
  return Promise.all(
    sections.map(async ({ content, ...section }) => ({
      ...section,
      hash: await sha256Hash(content),
    })),
  );
}

export function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function isVolatileFrontmatterLine(line: string): boolean {
  const match = /^([A-Za-z0-9 _-]+)\s*:/.exec(line);
  if (!match) {
    return false;
  }

  const key = match[1].trim().toLowerCase().replace(/[\s_]+/g, "-");
  return VOLATILE_FRONTMATTER_KEYS.has(key);
}
