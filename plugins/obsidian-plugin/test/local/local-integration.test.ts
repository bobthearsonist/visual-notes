import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import test from "node:test";
import { buildDailyContextExtractionInput, type DailyContext } from "../../src/daily-context";

interface LocalProfile {
  contextPath: string;
  extractionOutputPath?: string;
}

const profilePath = process.env.VISUAL_NOTES_LOCAL_PROFILE;

test("local Daily Context output can be adapted for Visual Notes extraction", () => {
  assert.ok(profilePath, "VISUAL_NOTES_LOCAL_PROFILE must be set.");
  const profile = readProfile(profilePath);
  const context = JSON.parse(readFileSync(resolve(profile.contextPath), "utf8")) as DailyContext;
  const extraction = buildDailyContextExtractionInput(context);

  assert.ok(extraction, "Daily Context output must contain at least one content source.");
  assert.equal(extraction.sourceContext.provider, "daily-context");
  assert.equal(extraction.processedHash, context.contextHash);
  assert.equal(extraction.sourceContext.sourceCount, extraction.sections.length);
  assert.ok(extraction.sections.length > 0, "Expected at least one extracted source section.");
  assert.match(extraction.markdown, /Source ID:/);
  assert.match(extraction.markdown, /Source kind:/);

  if (profile.extractionOutputPath) {
    writeLocalOutput(profile.extractionOutputPath, {
      markdown: extraction.markdown,
      sections: extraction.sections,
      sourceContext: extraction.sourceContext,
    });
  }
});

function readProfile(path: string): LocalProfile {
  const absolutePath = resolve(path);
  assert.ok(absolutePath.endsWith(".local.json"), "Local profile path must end with .local.json.");
  return JSON.parse(readFileSync(absolutePath, "utf8")) as LocalProfile;
}

function writeLocalOutput(outputPath: string, payload: unknown): void {
  const absolutePath = resolve(outputPath);
  const allowedRoot = resolve("test/local/.output");
  const relativeOutput = relative(allowedRoot, absolutePath);
  assert.ok(
    !relativeOutput.startsWith("..") && !isAbsolute(relativeOutput),
    "Local output must be inside test/local/.output.",
  );
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(payload, null, 2)}\n`);
}
