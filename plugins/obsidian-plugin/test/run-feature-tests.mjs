import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(root, ".test-build/feature-tests.mjs");

await mkdir(dirname(outfile), { recursive: true });
await esbuild.build({
  entryPoints: [resolve(root, "test/feature/sectioned-sidecar.test.ts")],
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
