---
description: Generate/refresh an Obsidian note's visual-notes graph via the PLUGIN engine — the Obsidian plugin's own LLM extractor (overrides the pin).
argument-hint: "[note path — defaults to the current/most-recent session doc]"
---

Generate the `visual-notes` concept map for **$ARGUMENTS** using the **plugin** engine (the Obsidian plugin's own LLM extractor), per the `visual-notes` skill's plugin mode:

1. Open the target note so it's the active file:
   ```bash
   obsidian open path="<note>.md"
   ```
2. Force the plugin to (re)extract — this overrides any `_pinned` and writes an unpinned, plugin-owned `{basename}-overview.json`:
   ```bash
   obsidian eval code="app.commands.executeCommandById('visual-daily-notes:regenerate-current-note-force')"
   ```

Extraction runs async (~$0.006 per run); the fence re-renders when the sidecar lands. To hand the doc back to the agent engine afterward, re-run `/obsidian-visual-summary-agent` (the hook re-pins).

If no target is given, use the current session document.
