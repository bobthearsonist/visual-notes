export interface MarkdownSection {
  id: string;
  title: string;
  level: number;
  ordinal: number;
  startLine: number;
  endLine: number;
  content: string;
}

export type MarkdownSectionSummary = Omit<MarkdownSection, "content"> & {
  hash: string;
};

interface MutableSection {
  id: string;
  title: string;
  level: number;
  ordinal: number;
  startLine: number;
  endLine: number;
}

interface HeadingState {
  level: number;
  idSegment: string;
}

interface FenceState {
  marker: "`" | "~";
  length: number;
}

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_PATTERN = /^ {0,3}(```+|~~~+)/;

export function parseMarkdownSections(markdown: string): MarkdownSection[] {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const siblingCounts = new Map<string, number>();
  const headingStack: HeadingState[] = [];
  const sections: MutableSection[] = [
    {
      id: "document",
      title: "Document",
      level: 0,
      ordinal: 0,
      startLine: 1,
      endLine: lines.length,
    },
  ];
  let current = sections[0];
  let fenceState: FenceState | null = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const fenceMatch = line.match(FENCE_PATTERN);
    if (fenceMatch) {
      const fenceText = fenceMatch[1];
      const marker = fenceText[0] as FenceState["marker"];
      if (fenceState?.marker === marker && fenceText.length >= fenceState.length) {
        fenceState = null;
      } else if (!fenceState) {
        fenceState = { marker, length: fenceText.length };
      }
      return;
    }

    if (fenceState) {
      return;
    }

    const heading = parseHeading(line);
    if (!heading) {
      return;
    }

    current.endLine = lineNumber - 1;
    while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= heading.level) {
      headingStack.pop();
    }

    const baseSlug = slugifyHeading(heading.title);
    const parentKey = headingStack.map((entry) => entry.idSegment).join("/");
    const countKey = `${parentKey}/${heading.level}/${baseSlug}`;
    const occurrence = (siblingCounts.get(countKey) ?? 0) + 1;
    siblingCounts.set(countKey, occurrence);

    const idSegment = occurrence === 1 ? `h${heading.level}-${baseSlug}` : `h${heading.level}-${baseSlug}-${occurrence}`;
    headingStack.push({ level: heading.level, idSegment });

    current = {
      id: headingStack.map((entry) => entry.idSegment).join("-"),
      title: heading.title,
      level: heading.level,
      ordinal: sections.length,
      startLine: lineNumber,
      endLine: lines.length,
    };
    sections.push(current);
  });

  const parsedSections = sections.map((section) => ({
    ...section,
    content: lines.slice(section.startLine - 1, section.endLine).join("\n"),
  }));

  return parsedSections.filter(
    (section) => section.content.trim().length > 0 || (section.id === "document" && parsedSections.length === 1),
  );
}

function parseHeading(line: string): { level: number; title: string } | null {
  const match = line.match(HEADING_PATTERN);
  if (!match) {
    return null;
  }

  return {
    level: match[1].length,
    title: match[2].trim(),
  };
}

function slugifyHeading(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "section";
}
