# Verification record

This document records executed checks for the working tree. Keep it distinct from planned acceptance criteria. The sample records under `tests/fixtures/` are shape-preserving and sanitized/synthetic; they are not performance measurements.

## Executed checks

- Node `v24.21.0` and npm `11.19.0` were selected via nvm; `.nvmrc` pins the runtime. `node:sqlite.DatabaseSync` was executed against an in-memory table.
- `npm ci && npm test && npm run check` → **38 TypeScript/Node tests passed**, and both CLI and viewer type-checks passed. Includes sanitized Claude/Codex imports, temporary Hermes SQLite, strict validation, evidence/merge behavior, CLI safeguards (including symlinked nested output), and a regression test executing the compiled viewer as a classic browser script. `git diff --check` passed.
- The mixed-agent integration test imported sanitized Claude/Codex record projections plus a temporary Hermes SQLite database made from a sanitized projection, validated the report, wrote a bounded packet, and exported a self-contained HTML file.
- A local read-only TypeScript smoke check discovered **266 Claude Code** and **59 Codex** session files and successfully parsed one recent file from each into a valid, excerpt-free report without displaying private content. No full private Hermes database analysis was run.
- Opened a freshly exported `file://` HTML report from an installed npm tarball in the browser: its embedded report rendered and a session inspector opened. No external resource fetches were observed. The first `web/index.html` smoke check missed a broken synthetic demo: an external ES module was blocked over `file://` without a console error. Reproduced the no-op click, switched to a classic deferred script, then re-opened the local file and confirmed the demo report, badge and summary rendered with no JS errors.
- `npm pack --pack-destination` built `agent-session-analysis-0.2.0.tgz`; a clean install under the scratch directory ran its `session-analysis` binary outside the checkout, analyzed a sanitized fixture, validated the report, and exported HTML. The package includes compiled CLI and viewer assets, not Python runtime files. Rebuild the tarball after source changes.

## Limitations to report

- No claim of actual savings, outcome verification, or billed cost without independent evidence.
- Native source format support may be narrower than a vendor's full set of exports; document unsupported variants.
- A passing structural test is not a behavioral evaluation of agent interpretation.
- No activation/publishing/commit unless explicitly requested. The npm package is local and marked private; no registry release is claimed.
- The sanitized fixtures establish compatibility with observed formats, not universal coverage of every historical vendor release. Real Hermes message content was not inspected in the live smoke check.
