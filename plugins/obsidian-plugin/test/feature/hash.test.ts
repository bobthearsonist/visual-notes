import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMarkdownForExtractionHash, semanticMarkdownHash, sha256Hash } from "../../src/hash";

test("semanticMarkdownHash ignores volatile frontmatter timestamps", async () => {
  const before = `---
created: 2026-05-09 09:00:00
modified: '2026-05-09 09:52:32'
updated: 2026-05-09T09:52:32-04:00
last_modified: 2026-05-09
tags:
  - daily
---

# Daily note

Meaningful content.
`;
  const after = `---
created: 2026-05-09 09:00:00
modified: '2026-05-09 09:59:00'
updated: 2026-05-09T09:59:00-04:00
last_modified: 2026-05-09 09:59:00
tags:
  - daily
---

# Daily note

Meaningful content.
`;

  assert.equal(await semanticMarkdownHash(before), await semanticMarkdownHash(after));
  assert.notEqual(await sha256Hash(before), await sha256Hash(after));
});

test("semanticMarkdownHash still changes when note body changes", async () => {
  const base = `---
modified: 2026-05-09 09:52:32
tags:
  - daily
---

# Daily note

Meaningful content.
`;
  const changed = `---
modified: 2026-05-09 09:59:00
tags:
  - daily
---

# Daily note

Meaningful content changed.
`;

  assert.notEqual(await semanticMarkdownHash(base), await semanticMarkdownHash(changed));
});

test("normalizeMarkdownForExtractionHash preserves nonvolatile frontmatter", () => {
  const markdown = `---
title: Cost controls
modified: 2026-05-09
created: 2026-05-01
---

Body.
`;

  assert.equal(
    normalizeMarkdownForExtractionHash(markdown),
    `---
title: Cost controls
created: 2026-05-01
---

Body.
`,
  );
});
