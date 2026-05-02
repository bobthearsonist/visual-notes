import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginDir = join(repoRoot, "plugins", "obsidian-plugin");
const outDir = join(repoRoot, "dist", "obsidian-plugin");

const requiredReleaseAssets = ["manifest.json", "main.js", "styles.css"];
const supportingAssets = ["versions.json"];
const allAssets = [...requiredReleaseAssets, ...supportingAssets];
const errors = [];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`Unable to read ${relative(repoRoot, path)}: ${error.message}`);
    return {};
  }
}

function requireString(object, key, file) {
  if (typeof object[key] !== "string" || object[key].trim() === "") {
    errors.push(`${file} must define a non-empty string "${key}"`);
  }
}

function requireExistingFile(path) {
  if (!existsSync(path)) {
    errors.push(`Missing ${relative(repoRoot, path)}`);
    return;
  }

  if (!statSync(path).isFile()) {
    errors.push(`${relative(repoRoot, path)} must be a file`);
    return;
  }

  if (statSync(path).size === 0) {
    errors.push(`${relative(repoRoot, path)} must not be empty`);
  }
}

function failIfInvalid() {
  if (errors.length === 0) {
    return;
  }

  console.error("Obsidian release packaging failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const manifestPath = join(pluginDir, "manifest.json");
const versionsPath = join(pluginDir, "versions.json");
const packagePath = join(pluginDir, "package.json");
const marketplaceManifestPath = join(repoRoot, "manifest.json");
const marketplaceVersionsPath = join(repoRoot, "versions.json");

const manifest = readJson(manifestPath);
const versions = readJson(versionsPath);
const pluginPackage = readJson(packagePath);
const marketplaceManifest = readJson(marketplaceManifestPath);
const marketplaceVersions = readJson(marketplaceVersionsPath);

requireString(manifest, "id", "manifest.json");
requireString(manifest, "name", "manifest.json");
requireString(manifest, "version", "manifest.json");
requireString(manifest, "minAppVersion", "manifest.json");
requireString(manifest, "description", "manifest.json");
requireString(manifest, "author", "manifest.json");
requireString(manifest, "authorUrl", "manifest.json");

if (manifest.id && !/^[a-z0-9-]+$/.test(manifest.id)) {
  errors.push('manifest.json "id" must be lowercase kebab-case for marketplace stability');
}

if (manifest.version !== pluginPackage.version) {
  errors.push(
    `manifest.json version (${manifest.version}) must match plugins/obsidian-plugin/package.json version (${pluginPackage.version})`,
  );
}

if (versions[manifest.version] !== manifest.minAppVersion) {
  errors.push(
    `versions.json must map ${manifest.version} to manifest minAppVersion ${manifest.minAppVersion}`,
  );
}

if (typeof manifest.isDesktopOnly !== "boolean") {
  errors.push('manifest.json "isDesktopOnly" must be a boolean');
}

if (JSON.stringify(marketplaceManifest) !== JSON.stringify(manifest)) {
  errors.push("root manifest.json must match plugins/obsidian-plugin/manifest.json");
}

if (JSON.stringify(marketplaceVersions) !== JSON.stringify(versions)) {
  errors.push("root versions.json must match plugins/obsidian-plugin/versions.json");
}

for (const asset of allAssets) {
  requireExistingFile(join(pluginDir, asset));
}

failIfInvalid();

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const asset of allAssets) {
  copyFileSync(join(pluginDir, asset), join(outDir, asset));
  requireExistingFile(join(outDir, asset));
}

failIfInvalid();

console.log(`Packaged Obsidian plugin ${manifest.id} ${manifest.version}:`);
for (const asset of allAssets) {
  const required = requiredReleaseAssets.includes(asset) ? "required" : "supporting";
  console.log(`- ${relative(repoRoot, join(outDir, asset))} (${required})`);
}
