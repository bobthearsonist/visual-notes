import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildDailyContextExtractionInput,
  getDailyContextApi,
  isExtractionCurrent,
  normalizeDailyContextDateFromPath,
  type DailyContext,
} from "../../src/daily-context";

const HASH_A = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HASH_C = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

test("getDailyContextApi discovers supported Daily Context plugin API", async () => {
  const context = dailyContext();
  const api = getDailyContextApi({
    plugins: {
      plugins: {
        "daily-context": {
          api: {
            version: 1,
            async getDailyContext() {
              return context;
            },
          },
        },
      },
    },
  });

  assert.ok(api);
  assert.equal((await api.getDailyContext("2026-05-11")).contextHash, HASH_A);
  assert.equal(getDailyContextApi({ plugins: { plugins: { "daily-context": { api: { version: 2 } } } } }), null);
});

test("normalizeDailyContextDateFromPath supports compact and dashed daily note names", () => {
  assert.equal(normalizeDailyContextDateFromPath("0 Daily ADHD Brain Logs/20260511.md"), "2026-05-11");
  assert.equal(normalizeDailyContextDateFromPath("Captains Log/2026-05-11.md"), "2026-05-11");
  assert.equal(normalizeDailyContextDateFromPath("Notes/meeting.md"), null);
});

test("buildDailyContextExtractionInput creates deterministic source sections and metadata", () => {
  const extraction = buildDailyContextExtractionInput(
    dailyContext({
      sources: [
        {
          id: "notes",
          kind: "daily-section",
          path: "0 Daily ADHD Brain Logs/20260511.md",
          label: "Notes",
          hash: HASH_B,
          content: "Manual note content.\nSecond source line.",
        },
        {
          id: "ignored-empty",
          kind: "date-tagged-file",
          path: "Projects/empty.md",
          label: "Empty",
          hash: HASH_C,
          content: "  ",
        },
        {
          id: "notes!",
          kind: "daily-section",
          path: "Projects/related.md",
          label: "Notes",
          hash: HASH_C,
          content: "Related file content.",
        },
      ],
    }),
  );

  assert.ok(extraction);
  assert.equal(extraction.processedHash, HASH_A);
  assert.equal(extraction.processedHashKind, "daily-context");
  assert.equal(extraction.sourceContext.sourceCount, 2);
  assert.deepEqual(
    extraction.sourceContext.sources.map((source) => source.id),
    ["notes", "notes!"],
  );
  assert.deepEqual(
    extraction.sections.map((section) => section.id),
    ["dc-daily-section-notes", "dc-daily-section-notes-2"],
  );
  assert.ok(extraction.sections.every((section) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(section.id)));
  assert.equal(extraction.sections[0].startLine, 6);
  assert.equal(extraction.sections[0].endLine, 15);
  assert.equal(extraction.markdown.split("\n")[14], "Second source line.");
  assert.match(extraction.markdown, /Source ID: notes/);
  assert.match(extraction.markdown, /Section ID: dc-daily-section-notes-2/);
});

test("buildDailyContextExtractionInput consumes representative fixture output", () => {
  const fixture = JSON.parse(
    readFileSync(resolve("test/fixtures/daily-context/generic-context.json"), "utf8"),
  ) as DailyContext;
  const extraction = buildDailyContextExtractionInput(fixture);

  assert.ok(extraction);
  assert.equal(extraction.processedHash, fixture.contextHash);
  assert.equal(extraction.processedHashKind, "daily-context");
  assert.equal(extraction.sourceContext.provider, "daily-context");
  assert.equal(extraction.sourceContext.schemaVersion, 3);
  assert.equal(extraction.sourceContext.sourceCount, 3);
  assert.deepEqual(
    extraction.sections.map((section) => section.id),
    [
      "dc-daily-prelude-daily-prelude-journal-20260511",
      "dc-daily-section-daily-section-journal-notes",
      "dc-date-tagged-file-related-summary",
    ],
  );
  assert.match(extraction.markdown, /Source kind: daily-section/);
  assert.match(extraction.markdown, /Related project summary/);
  assert.doesNotMatch(extraction.markdown, /```dataview|```tasks/u);
});

test("buildDailyContextExtractionInput returns null when no sources have content", () => {
  assert.equal(
    buildDailyContextExtractionInput(
      dailyContext({
        sources: [
          {
            id: "empty",
            kind: "daily-section",
            path: "Daily/20260511.md",
            label: "Empty",
            hash: HASH_B,
          },
        ],
      }),
    ),
    null,
  );
});

test("buildDailyContextExtractionInput caps source context entries at schema maximum", () => {
  const extraction = buildDailyContextExtractionInput(
    dailyContext({
      sources: Array.from({ length: 205 }, (_, index) => ({
        id: `source-${String(index).padStart(3, "0")}`,
        kind: "date-tagged-file",
        path: `Projects/source-${index}.md`,
        label: `Source ${index}`,
        hash: HASH_B,
        content: `Source ${index} content.`,
      })),
    }),
  );

  assert.ok(extraction);
  assert.equal(extraction.sections.length, 200);
  assert.equal(extraction.sourceContext.sourceCount, 200);
  assert.equal(extraction.sourceContext.sources.length, 200);
});

test("isExtractionCurrent compares processed hashes by source kind and preserves legacy markdown skips", () => {
  assert.equal(
    isExtractionCurrent({
      existingHash: HASH_A,
      existingHashKind: "daily-context",
      processedHash: HASH_A,
      processedHashKind: "daily-context",
      rawHash: HASH_B,
    }),
    true,
  );
  assert.equal(
    isExtractionCurrent({
      existingHash: HASH_A,
      existingHashKind: "semantic-markdown",
      processedHash: HASH_A,
      processedHashKind: "daily-context",
      rawHash: HASH_B,
    }),
    false,
  );
  assert.equal(
    isExtractionCurrent({
      existingHash: HASH_B,
      existingHashKind: undefined,
      processedHash: HASH_A,
      processedHashKind: "semantic-markdown",
      rawHash: HASH_B,
    }),
    true,
  );
});

function dailyContext(overrides: Partial<DailyContext> = {}): DailyContext {
  return {
    schemaVersion: 3,
    parserVersion: 1,
    generatedAt: "2026-05-11T21:00:00.000Z",
    date: "2026-05-11",
    dateTag: "date/2026/05/11",
    contextHash: HASH_A,
    contexts: [{ id: "personal", dailyFolder: "0 Daily ADHD Brain Logs", aiSessionFolders: ["0 AI Sessions"] }],
    sources: [],
    ...overrides,
  };
}
