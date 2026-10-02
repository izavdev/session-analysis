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

The report viewer is entirely static: HTML, CSS, and browser JavaScript, with no backend or runtime Node requirement. Reports and source logs selected in the viewer stay in browser memory. Analysis still runs locally through the CLI.

```sh
npm ci
npm run build:pages
```

Publish the generated `_site/` directory to any static host. It contains `index.html`, `setup.html`, `style.css`, `app.js`, `.nojekyll`, and the two curated demo files under `examples/`; the build recreates this directory to discard stale files. Other reports, logs, fixtures, and CLI code are excluded. The bundled demo is a sanitized excerpt of the previous Codex session for this repo, with a downloadable report and session JSONL. Select **Try real session demo**, expand Evidence under **Worth reviewing**, and choose **Inspect source** to see its recorded call/result and nearby context immediately. See [demo provenance](web/examples/README.md). Relative asset and navigation URLs support both a repository path such as `/session-analysis/` and a custom domain, without rewrites or base-path configuration. The existing offline viewer and exported HTML continue to work.

For GitHub Pages, select **Settings → Pages → Build and deployment → Source → GitHub Actions** ([GitHub setup documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)). The included `.github/workflows/pages.yml` tests and builds on pushes and pull requests, then publishes on default-branch pushes or a manual run on the default branch. Allow that branch in the `github-pages` environment's deployment rules. No GitHub settings are changed by the local build.

For Claude Code or Codex rollout tool or request evidence, expand an observation's Evidence list (ordinary reads are in the collapsed **Activity** section), click **Inspect source**, and choose the matching session `.jsonl` (up to 20 MiB). User/assistant text evidence can be viewed locally too; injected metadata is rejected. For tool evidence, the local inspector shows:
- A readable description for supported literal `cat`/`sed` reads or a native `Read` input; otherwise the original tool input, without guessing intent or running commands.
- The nearest preceding non-metadata user request and assistant explanation, searched within 100 source lines.
- The selected tool input and result, capped at 100,000 characters per source entry.
- The next recorded assistant action within 20 source lines, stopping at a new user request or session boundary. This is not a verified outcome.

Surrounding context is capped at 4,000 characters per entry; missing context and truncation are explicit. Source contents are read in browser memory and are never embedded in the exported report, uploaded, or saved in browser storage. Close the source inspector or clear/replace the report to remove the preview; stale pending reads cannot repopulate it. Previewed content can contain secrets; do not share screenshots without review. Browsers do not provide the selected file's absolute path, so the viewer cannot form a reliable external editor deep link.

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

The packet has a **serialized character budget**, not a claimed token budget. Interpretation is optional and uses the agent you are already working with. No model calls happen inside this toolkit. The merger rejects unknown references and attempts to replace computed metrics; it cannot guarantee a model's explanation is true.

## Portable skill

The editable source is [skills/session-analysis/SKILL.md](skills/session-analysis/SKILL.md). Nothing is installed automatically.

Without activation, ask an agent:

> Read `skills/session-analysis/SKILL.md` in this repository and analyze these selected sessions. Use metrics-only first and propose improvements backed by evidence.

For activation, make the built CLI available in the agent's Node environment. The repository is not published to npm; do not assume a bare remote `npx session-analysis` resolves to this project. Install this local checkout or its packed tarball explicitly:

```sh
npm install -g /absolute/path/to/session-analysis
```

Then copy the **entire** `skills/session-analysis` folder into the chosen agent's skill directory. Do not overwrite an existing skill without reviewing it.

| Agent | User-owned skill location |
|---|---|
| Claude Code | `~/.claude/skills/session-analysis/` |
| Codex | `~/.agents/skills/session-analysis/` |
| Hermes | `${HERMES_HOME:-$HOME/.hermes}/skills/session-analysis/` for the active profile |

Keep this repository as the editable source; copies are snapshots that must be deliberately updated. Restart/refresh the agent according to its normal skill discovery workflow. Installation is not complete until that agent actually discovers the skill. The toolkit does not configure another profile.

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
