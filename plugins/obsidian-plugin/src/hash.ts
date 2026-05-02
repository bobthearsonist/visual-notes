import { parseMarkdownSections, type MarkdownSectionSummary } from "./sections";

export async function sha256Hash(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = Array.from(new Uint8Array(digest));
  return `sha256:${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
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
