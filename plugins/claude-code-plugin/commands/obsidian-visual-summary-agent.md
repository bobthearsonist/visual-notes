---
description: Generate/refresh an Obsidian note's visual-notes graph via the AGENT engine — you author the sidecar from session context; the hook conforms + pins it.
argument-hint: "[note path or session topic — defaults to the current/most-recent session doc]"
---

Generate the `visual-notes` concept map for **$ARGUMENTS** using the **agent** engine.

Invoke the `visual-notes` skill in **agent mode**:

- Build the graph from full session context and write the sidecar to the note's `{basename}-overview.json` (session doc → `{YYYY-MM-DD topic}-overview.json` beside it; daily note → `{YYYYMMDD}-overview.json`).
- Follow the skill's **Sidecar JSON Format** exactly: kebab-case node ids, node `classes` `{system|task|decision} {completed|active|context|blocked}`, bounded `position`, edge `classes` `strong-edge`/`weak-edge` (or omit), labels non-empty.
- The PostToolUse hook conforms the graph to the strict schema and stamps `_pinned: true`; the note's ` ```visual-notes ` fence then renders it. You don't write HTML.

If no target is given, use the current session document — or the most recent one in the active context's session folder (the folders are listed in the config file named by the Visual Notes plugin's **Agent config file** setting).
