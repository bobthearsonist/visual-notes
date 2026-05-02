import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(pluginDir, "..", "..");
const manifestPath = join(pluginDir, "manifest.json");
const versionsPath = join(pluginDir, "versions.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const versions = JSON.parse(readFileSync(versionsPath, "utf8"));

versions[manifest.version] = manifest.minAppVersion;

writeFileSync(versionsPath, `${JSON.stringify(versions, null, "\t")}\n`);
copyFileSync(manifestPath, join(repoRoot, "manifest.json"));
copyFileSync(versionsPath, join(repoRoot, "versions.json"));
