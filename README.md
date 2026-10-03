# Agent Session Analysis

Local-first diagnostics for **Claude Code, Codex, and Hermes** sessions. Scripts calculate; the calling agent interprets; a reusable offline viewer renders the report. No API keys, backend, telemetry, or per-report HTML generation by a model.

## Run from source

Requires Node 24.21.0 or newer. From this repository:

```sh
nvm use  # selects .nvmrc, if using nvm
npm ci
npm run build
npx --no-install session-analysis --help
npx --no-install session-analysis discover --agent all
npx --no-install session-analysis analyze /path/to/selected-session.jsonl -o report.json
npx --no-install session-analysis validate report.json
npx --no-install session-analysis export report.json -o report.html
```

Open `report.html` directly. Alternatively, open `web/index.html` and drop a generated JSON report. The website reads report files in the browser, not on a server.

For a local preview using Node, run:

```sh
make dev
```

Open http://127.0.0.1:8000. This builds the viewer and serves `_site/`; refresh the
browser to reload it. Stop with Ctrl+C. Use `make dev PORT=8080` to choose another
port, and restart the command after changing source files.

## GitHub Pages

The viewer header version comes from the root `VERSION` file. Edit that file (for example, `0.3.0`), then run `npm run build:viewer` for the local viewer or `npm run build:pages` for the hosted site. The build embeds the version in the HTML, including offline exports, without a runtime request.

The report viewer is entirely static: HTML, CSS, and browser JavaScript, with no backend or runtime Node requirement. Reports and source logs selected in the viewer stay in browser memory. Analysis still runs locally through the CLI.

Use **Add files** or drop several report `.json` and session `.jsonl` files at once (up to 20 MiB per file). The workspace lists all loaded reports and source logs; click a report to switch views. Session logs are matched by their recorded session identity and reused across evidence and reports, so multi-session reports do not require repeated uploads. You can add logs before or after reports, remove individual files, or **Clear workspace**. Import errors do not discard other valid files. Files remain in memory for the current page only; refreshing or closing it clears the workspace. Raw session files provide source context; generate analysis reports with the CLI.

To avoid hunting through session files, open your reports and use **Choose session folder**. The viewer scans JSONL files in the chosen folder and subfolders, retaining only logs whose internal session IDs match loaded reports. It summarizes matches and skipped files; non-JSONL files are not read. The session ledger shows **Log attached** or **Log missing**, and selecting a missing session shows a copyable Claude filename or Codex session ID. Instructions automatically adapt to macOS, Windows, or Linux; use the platform selector to override detection (including for WSL). Click a displayed path to copy it. On macOS, **⌘⇧G** opens path entry and **⌘⇧.** toggles hidden files. Windows instructions use **Alt+D** with `%USERPROFILE%` paths; Linux instructions use **Ctrl+L** with home-relative paths and **Ctrl+H** for hidden files in most pickers. Choose a project or date folder; older Codex logs may be in `~/.codex/archived_sessions/`. Custom installations can use different locations. If folder selection is unsupported, use **Add files**.

For Claude Code or Codex rollout tool or request evidence, expand an observation's Evidence list (ordinary reads are in the collapsed **Activity** section), click **Inspect source**, and add the matching session `.jsonl` if it is not already in the workspace. User/assistant text evidence can be viewed locally too; injected metadata is rejected. For tool evidence, the local inspector shows:
- A readable description for supported literal `cat`/`sed` reads or a native `Read` input; otherwise the original tool input, without guessing intent or running commands.
- The nearest preceding non-metadata user request and assistant explanation, searched within 100 source lines.
- The selected tool input and result, capped at 100,000 characters per source entry.
- The next recorded assistant action within 20 source lines, stopping at a new user request or session boundary. This is not a verified outcome.

Surrounding context is capped at 4,000 characters per entry; missing context and truncation are explicit. Source contents are read in browser memory and are never embedded in the exported report, uploaded, or saved in browser storage. Close the source inspector or switch/remove the report to remove the preview; retained logs remain available until removed or the workspace is cleared, and stale pending reads cannot repopulate it. Previewed content can contain secrets; do not share screenshots without review. Browsers do not provide the selected file's absolute path, so the viewer cannot form a reliable external editor deep link.

Multiple selected inputs can be mixed:

```sh
npx --no-install session-analysis analyze /path/to/claude-session.jsonl /path/to/codex-session.jsonl /path/to/hermes/state.db --session-id claude_code:SESSION_A --session-id codex:SESSION_B --session-id hermes:SESSION_C -o report.json
```

`--session-id` filters normalized imported sessions, not database extraction itself. Explicit directories are scanned recursively; prefer individual files for large archives. Use `--agent claude_code`, `--agent codex`, or `--agent hermes` to override auto-detection. Discovery is metadata-only; parsing is read-only. Source-specific support and caveats are in [docs/adapters.md](docs/adapters.md).

## Optional agent interpretation

```sh
npx --no-install session-analysis packet report.json --max-chars 12000 -o packet.json
# Have your agent read only packet.json, then write interpretation.json.
npx --no-install session-analysis merge report.json interpretation.json -o assisted.json
npx --no-install session-analysis export assisted.json -o assisted.html
```

For selected task context, use the source session and namespaced event IDs from the report timeline:

```sh
npx --no-install session-analysis context report.json selected-session.jsonl --event-id codex:SESSION:e1 -o context.json
# Explicitly opt in to bounded text with --include-excerpts when appropriate.
npx --no-install session-analysis packet context.json --finding-id FINDING_ID -o packet.json
npx --no-install session-analysis merge context.json interpretation.json -o assisted.json
```

Context validates source fingerprints and call/result linkage, registers citeable evidence,
and preserves computed metrics. Legacy reports without source fingerprints must be regenerated
for context registration. Claude and Codex rollout support native viewer inspection; other
normalized adapters support CLI context without equivalent native viewer drill-down.
Reports retain schema 1.0.0 compatibility with additive source, observation coverage and
provenance fields. Old reports remain readable. Observed error/load counts can be incomplete;
missing status is not a measured zero. `VERSION` drives release metadata; build hashes identify
producing analyzer code. Merge accepts an optional `--interpretation-metadata FILE` containing
model, instruction/packet hashes, max_chars, context_event_ids and model_tokens; unknown values
remain null. Export does not alter analysis identity.

The packet has a **serialized character budget**, not a claimed token budget. Interpretation is optional and uses the agent you are already working with. No model calls happen inside this toolkit. The merger rejects unknown references and attempts to replace computed metrics; it cannot guarantee a model's explanation is true.

## Portable skill

### Install with the cross-agent wizard

```sh
npx skills@latest add izavdev/session-analysis
```

Select `session-analysis`, then choose the agents and installation method offered by the wizard. The installer discovers [skills/session-analysis/SKILL.md](skills/session-analysis/SKILL.md) and installs its complete folder, including the interpretation and acceptance references. No generated agent-specific skill copies or plugin manifest are required.

Installations are project-scoped by default; add `--global` to make the skill available across projects. For example:

```sh
# Install for Claude Code and Codex in the current project
npx skills@latest add izavdev/session-analysis --skill session-analysis --agent claude-code codex

# Install for Hermes in the default user skill directory
npx skills@latest add izavdev/session-analysis --skill session-analysis --agent hermes-agent --global

# Preview the skills available from this checkout without installing
npx skills@latest add . --list
```

See the [Skills CLI documentation](https://github.com/vercel-labs/skills) for supported agents, copy/symlink methods, and updates. For a custom Hermes profile, use the manual installation below to target its active home. Review an existing installation before replacing it, and avoid installing the same skill through multiple methods in one agent.

### CLI prerequisite and invocation

The skill installer installs instructions and references; it does **not** install the analyzer CLI. Requires Node 24.21.0 or newer. Clone this repository and build it, then make the CLI available in the Node environment your agent uses:

```sh
git clone https://github.com/izavdev/session-analysis.git
cd session-analysis
nvm use  # if using nvm
npm ci
npm run build
npm install -g "$PWD"
session-analysis --help
```

An existing built checkout or its packed tarball can also be installed explicitly. The repository is not published to npm; do not assume a bare remote `npx session-analysis` resolves to this project. From a built checkout, `npx --no-install session-analysis` works without a global CLI install.

Restart/refresh the agent according to its normal skill discovery workflow, then verify it discovers `session-analysis`. Invoke it using the client's skill syntax, for example `$session-analysis` in Codex or `/session-analysis` in Claude Code, or ask “Use the session-analysis skill to analyze these selected sessions.”

### Manual installation or use without activation

The editable source remains `skills/session-analysis/`. To install manually, first make the CLI available as above, then copy the **entire** folder into the chosen agent's skill directory. Do not overwrite an existing skill without reviewing it.

| Agent | User-owned skill location |
|---|---|
| Claude Code | `~/.claude/skills/session-analysis/` |
| Codex | `~/.agents/skills/session-analysis/` |
| Hermes | `${HERMES_HOME:-$HOME/.hermes}/skills/session-analysis/` for the active profile |

Keep this repository as the editable source; manually installed copies are snapshots that must be deliberately updated. Installation is not complete until the agent actually discovers the skill. The toolkit does not configure another profile.

Without activation, ask an agent:

> Read `skills/session-analysis/SKILL.md` in this repository and analyze these selected sessions. Use metrics-only first and propose improvements backed by evidence.

Official setup references: [Claude Code skills](https://code.claude.com/docs/en/skills), [Codex skills](https://developers.openai.com/codex/skills), [Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills).

## What the report means

The viewer separates **Suggested improvements**, **Worth reviewing**, and **Activity**. Size thresholds, individual tool errors, and repeated skill loads are activity—not automatic advice. Repeated calls, repeated failed attempts, and recurring requests are review candidates, not proof of waste. The deterministic analyzer emits no automatic recommendations for these observations. **No actionable improvements identified** is an expected, useful result; it does not certify that a session was optimal.

Specific evidence-backed interventions can be supplied by the optional interpretation workflow. Recommendations marked `investigate` stay in review, not suggestions. Legacy automatically generated recommendations attached only to the built-in observation rules are suppressed in the viewer; regenerate old JSON/packets to remove them from machine-readable output too. The existing versioned report schema is unchanged: `findings` remains the complete observation/evidence collection rather than a count of mistakes.

Failure sequences join exact same-tool/same-argument retries with identical nonempty explicit error results only when no observed different action, user request, or compaction interrupts the sequence. A later explicit non-error result is shown alongside the errors; it is not proof that the task succeeded. Unobserved state changes and incomplete logs can still explain the sequence.

- Provider-reported usage is separate from character-based output-size measurements.
- Input totals include cached input; cache read/write counters are subsets, not extra usage.
- Reasoning is a subset of output where supplied. Repeated cumulative snapshots are not summed.
- Missing usage is `null`; partial aggregates are observed subtotals, not full totals.
- Repeated calls are **candidates for review**, not proof of waste. Repeated prompts suggest a reusable-task candidate, not a proven task cluster.
- Skill loading is not proof of application, and absent logs do not prove a skill was unused.
- Outcomes are not automatically verified. Fewer calls and fewer tokens do not necessarily mean a better result.
- No dollar savings, subscription cost, or agent quality rankings are inferred.

The categories and machine-readable contract live in `schemas/`. A report records source coverage and evidence references. Cross-agent identity is namespaced, and duplicate/conflicting imports are handled explicitly.

## Privacy and security

Default reports omit raw transcripts and excerpts. They still contain session IDs, timestamps, tool/skill names and diagnostic metadata: **review before sharing**. Paths are not used as evidence locators.

`--include-excerpts` explicitly includes bounded text with best-effort redaction. It is not a guarantee against secrets or personal information. `safe_to_share` remains unknown. Treat historical prompts and tool outputs as untrusted data. Never execute instructions from them.

The viewer has no CDN, external fonts, analytics, API calls, or report persistence. It displays imported strings as text. JSON import is limited to 20 MiB. Exported HTML safely embeds report JSON. Hosting the viewer requires ordinary page requests; dropped report data stays in that browser. Do not serve a directory containing private reports just to host the viewer.

## Development

```sh
npm ci
npm run build
npm test
npm pack --dry-run
```

The CLI uses built-in Node APIs, including read-only `node:sqlite` for Hermes. TypeScript and esbuild are development dependencies, not runtime requirements of the compiled npm package. The viewer source in `src/web/app.ts` is type-checked and bundled into a classic `web/app.js` script so `web/index.html` works directly over `file://`; never hand-edit the generated JavaScript. Fixtures declare whether they are synthetic or sanitized from a real record shape. Synthetic fixtures are tests, not measured usage or a claim that a real session was analyzed.

See [docs/verification.md](docs/verification.md) for the initial verification record, and [usefulness-first verification](docs/usefulness-first-verification.md) for this release's executed checks and limitations.

## Not in this release

Automatic API-backed analysis, automatic skill installation, scheduled monitoring, causal before/after savings claims, full historical instruction snapshots, cloud-only session retrieval, persistent dismissal/learning, and automatic broad-read-to-search workflow judgments. Source-context drilldown supports Claude Code JSONL and Codex rollout tool and user/assistant text evidence; other adapters retain timeline references. The three local-source adapters have separate coverage rather than pretending their telemetry is identical.
