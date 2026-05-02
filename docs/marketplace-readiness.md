# Obsidian marketplace readiness

This checklist tracks the work needed to submit Visual Notes to the Obsidian
Community Plugins marketplace while preserving the repository's monorepo layout.

## Repository layout decision

Visual Notes should remain a monorepo for now:

- `plugins/obsidian-plugin` is the primary marketplace artifact.
- `plugins/claude-code-plugin` remains an optional companion plugin.
- `shared/schema.json` is the contract both plugins consume.

Obsidian's community plugin directory only records a GitHub repository, not a
subdirectory. Obsidian reads `manifest.json` and `README.md` from the repository
root for the plugin detail page and latest-version lookup, while install files
come from GitHub release assets. To keep the monorepo without moving the plugin
source, this repo maintains marketplace-facing root mirrors of:

- `manifest.json`
- `versions.json`

The source plugin remains in `plugins/obsidian-plugin`, and the packaging script
fails if the root metadata drifts from the plugin metadata. The Obsidian release
boundary is the packaged contents of `dist/obsidian-plugin`.

## Release assets

Run from the repository root:

```bash
pnpm package:obsidian
```

The command builds the Obsidian plugin and writes:

- `dist/obsidian-plugin/manifest.json` — required release asset
- `dist/obsidian-plugin/main.js` — required release asset
- `dist/obsidian-plugin/styles.css` — required release asset
- `dist/obsidian-plugin/versions.json` — supporting version metadata for review

The packaging script verifies:

- `manifest.json` has required marketplace metadata.
- `manifest.id` is stable lowercase kebab-case.
- `manifest.version` matches `plugins/obsidian-plugin/package.json`.
- `versions.json` maps the manifest version to `manifest.minAppVersion`.
- repository-root `manifest.json` and `versions.json` match the plugin copies.
- every release asset exists and is non-empty.

## Version and tag workflow

1. Update `plugins/obsidian-plugin/package.json` and
   `plugins/obsidian-plugin/manifest.json` to the same version.
2. If `minAppVersion` changes, update it in `manifest.json`.
3. Run:

   ```bash
   pnpm --filter @visual-notes/obsidian-plugin run version
   pnpm build
   pnpm typecheck
   pnpm package:obsidian
   ```

   The plugin `version` script updates `versions.json` and syncs the
   repository-root marketplace metadata mirrors.

4. Create a GitHub release tag named `X.Y.Z`, exactly matching `manifest.json`'s
   `version` value. Do not prefix the tag with `v`.
5. Upload these files from `dist/obsidian-plugin` as top-level release assets:
   `manifest.json`, `main.js`, and `styles.css`.

## Marketplace submission checklist

- [x] MIT license is present at repository root.
- [x] Plugin ID is stable: `visual-notes`.
- [x] Plugin metadata is present: name, author, author URL, description,
      version, minimum app version, and desktop/mobile support flag.
- [x] Repository-root metadata is present for Obsidian's plugin detail page and
      latest-version lookup.
- [x] Release packaging produces the required Obsidian assets.
- [x] Version checks ensure `manifest.json`, `package.json`, and `versions.json`
      stay aligned.
- [x] README and plugin README document setup, privacy, and expected Anthropic
      API costs.
- [ ] Create first GitHub release with `manifest.json`, `main.js`, and
      `styles.css` uploaded as release assets.
- [ ] Smoke-test the release by manually installing the three release assets in
      an Obsidian vault.
- [ ] Add stable screenshots or a short GIF once the UI is final enough.
- [ ] Submit a PR to `obsidianmd/obsidian-releases` after the first release is
      available.

## Current blockers before marketplace submission

- No public release has been cut yet, so the marketplace submission cannot point
  reviewers at downloadable release assets.
- Screenshots/GIFs are still pending.
- A final manual Obsidian smoke test from release assets is still required.
