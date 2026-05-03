import { mkdir, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const featureTestRoot = resolve(root, "test/feature");
const outfile = resolve(root, ".test-build/feature-tests.mjs");

const entryPoints = await collectFeatureTests(featureTestRoot);
if (entryPoints.length === 0) {
  throw new Error(`No feature tests found in ${featureTestRoot}`);
}

await mkdir(dirname(outfile), { recursive: true });
await esbuild.build({
  stdin: {
    contents: entryPoints.map(toImport).join("\n"),
    resolveDir: root,
    sourcefile: "feature-tests-entry.mjs",
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
});

process.exit(result.status ?? 1);

async function collectFeatureTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectFeatureTests(absolutePath);
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
