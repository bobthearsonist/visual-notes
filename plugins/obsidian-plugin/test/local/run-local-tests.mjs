import { spawnSync } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

if (!process.env.VISUAL_NOTES_LOCAL_PROFILE) {
  console.error("Set VISUAL_NOTES_LOCAL_PROFILE to a gitignored local profile JSON to run local tests.");
  process.exit(1);
}

const localTestRoot = resolve(root, "test/local");
const outfile = resolve(root, ".test-build/local-tests.mjs");
const entryPoints = await collectLocalTests(localTestRoot);

await mkdir(dirname(outfile), { recursive: true });
await esbuild.build({
  stdin: {
    contents: entryPoints.map(toImport).join("\n"),
    resolveDir: root,
    sourcefile: "local-tests-entry.mjs",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outfile,
  sourcemap: "inline",
});

const result = spawnSync(process.execPath, ["--test", outfile], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);

async function collectLocalTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== ".output") {
        return collectLocalTests(absolutePath);
      }
      return entry.isFile() && entry.name.endsWith(".test.ts") ? [absolutePath] : [];
    }),
  );

  return files.flat().sort();
}

function toImport(entryPoint) {
  const relativePath = relative(root, entryPoint).split(sep).join("/");
  return `import "./${relativePath}";`;
}
