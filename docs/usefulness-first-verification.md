# Usefulness-first release verification

## Delivered behavior

- The deterministic analyzer retains observations and evidence but no longer creates automatic recommendations from output-size thresholds, repeated calls, skill loads, individual errors, or matching requests.
- The viewer separates Suggested improvements, Worth reviewing, and collapsed Activity. Legacy recommendations attached only to built-in observation rules do not become actionable suggestions.
- Exact sequential same-tool/same-argument calls with identical nonempty explicit errors form one review episode. Observed explicit non-error retries are included without claiming the task succeeded. Unknown results, different actions, user requests, compaction, concurrency, and ambiguous linkage prevent unsupported recovery/episode claims.
- Claude JSONL drill-down renders the chosen tool/input/result or genuine user/assistant text locally. Supported literal read commands receive descriptions; unsupported shell syntax remains original input and is never executed.
- Tool drill-down includes bounded preceding request/assistant context and next recorded action where present. Missing context, truncation and unknown outcomes are explicit. Closing, clearing, or replacing the report invalidates pending source reads.
- The portable skill, interpretation guide, and acceptance scenarios document the same evidence gate. No new runtime installation, publication, or commit was made.

## Executed checks

- `npm test`: 61 tests passed, including RED-to-GREEN regressions for activity/advice separation, failure episodes, recovery, local context, metadata exclusion, shell-description fallbacks, safe text rendering, and pending-read cancellation.
- `npm run check`: passed for CLI and browser TypeScript projects.
- `git diff --check`: passed (repository files are currently untracked; this does not itself validate their content).
- `npm pack --dry-run`: confirmed the packaged file list includes the portable skill, its interpretation and acceptance references, schema, CLI, and viewer assets.
- Portable skill relative-reference checks passed. Acceptance scenarios are specifications; no separate model behavioral evaluation was performed.
- Re-analyzed only the three previously selected main Claude sessions. JSON validated; standalone HTML and bounded packet were regenerated without excerpts. The selected report retains 242 observed tool calls, five Activity observations, one recurring-request review candidate, and zero automatic recommendations. This is not a claim that the sessions were optimal.
- Browser opened the final HTML directly through `file://`. Verified Suggestions empty state, one review card, two grouped Activity cards collapsed by default, matching-source selection, real file-read descriptions and source lines, agent filtering, and clear behavior.
- The real source drill-down resolved the preceding user request at line 11, selected call/result at lines 48/49, and next recorded assistant action at line 57. Transcript contents were not copied into this verification document or embedded in the report.
- Browser runtime-error capture reported no errors during the tested interactions. No external HTTP(S) resource requests occurred. Imported source text did not create executable script elements.

## Boundaries

This release does not establish causal waste or monetary savings. It does not implement persistent dismissals/learning, automatic broad-read-to-search judgments, or source-context previews for Codex/Hermes. The versioned report schema remains unchanged; `findings` means observations, not proven mistakes. Old saved HTML files need re-exporting to receive the new viewer, and old machine-readable reports need re-analysis to remove automatic recommendations.
