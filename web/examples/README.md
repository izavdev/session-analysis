# Real-session demo

`codex-pages-session.jsonl` is a sanitized, selected excerpt of the preceding
Codex session for this repository, recorded on 2026-10-02. The task was to make
the viewer compatible with GitHub Pages. It is real recorded activity, not a
synthetic conversation or a full session export.

The excerpt retains the task request, two assistant progress messages, two
tool calls and their matching results, and the closing assistant message.
Original source lines were 9, 12, 43, 59, 62, 67, 70, and 73. Line references
in the accompanying report refer to the **excerpt file**, not the original.
Personal absolute paths are replaced with `/workspace/session-analysis`,
session/call IDs are replaced, and internal metadata, instructions, reasoning,
usage snapshots, and unrelated turns are omitted. Text and tool outputs in
the selected records are otherwise retained, including historical claims.

`codex-pages-report.json` was calculated by the local analyzer from this file,
then annotated with one editorial review observation and excerpt limitations.
Its two tool calls are excerpt counts. Token usage is unavailable. No workflow
improvement or deployed-site outcome is asserted. The observation offers a
concrete place to check commands, results, and the closing claim.

The static build publishes only these two explicitly named demo files.
`scripts/build-demo.mjs` generates `src/web/demo-source.json` from the curated
JSONL so the demo source preview works offline, without fetching or choosing a
file. Other reports still require explicitly selecting the matching local log.
