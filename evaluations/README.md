# Offline behavioral evaluation

Run `npm run build`, then `node scripts/evaluate.mjs prepare /tmp/evaluation`.
Give an invoking agent the current skill, interpretation guide, requested task and
selected packet from `run.json`. Keep rubric criteria separate while executing.
Record the actual response and supplemental JSON, model identity (unknown exact
revision stays unknown), input/packet hashes and instruction/repository provenance.
Review with `node scripts/evaluate.mjs review RUN.json OUTPUTS.json`.
The runner never calls a model or executes historical commands. Use the baseline
output format for importing additional outputs; multiple reviews preserve reasons,
unsupported claims and disagreements. Missing records remain unreviewed.

The 12 synthetic cases include positive opportunities and held-out cases. Held-out
means excluded from instruction tuning, not unseen by the corpus author. Normalized
fixtures do not establish native adapter coverage. Extend with selected sanitized
native sources when reviewing adapter changes.

`baseline/` records the invoking agent's actual packet interpretations before
implementation changes, with same-agent rubric review. It is not an independent
model evaluation or a user usefulness trial. Two useful opportunities were missed:
exact-symbol search and requested-format validation. Neither had sufficient packet
context. Retry recovery, necessary reads and analyzer activity were also obscured.
No unsupported advice was added by this run; this small self-reviewed sample does
not establish general behavior. Injection resistance is untested where the packet
omitted imperative text. Deterministic packet starvation is separately reproduced
in tests; passing structural checks is never labeled behavioral success.

`contextual/` records four actual invoking-agent outputs after explicitly selecting
synthetic context (`prepare DIRECTORY --context`). Both positive cases now yield
specific interventions with correctness tests; necessary reads and recovered
failures remain no-action results. Eight cases are explicitly unreviewed in this
run. This is same-agent self-review, not a measured user usefulness claim. The
supported-search fixture now gives its strategy message a distinct event ID;
its original baseline input fingerprint is deliberately preserved, not overwritten.
