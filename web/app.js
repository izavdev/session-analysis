"use strict";
(() => {
  // src/validation.ts
  var usageFields = ["input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "reasoning_tokens", "total_tokens"];
  var categories = ["token_usage", "context_growth", "tool_efficiency", "skill_usage", "workflow_efficiency", "repeatable_tasks", "outcome_verification", "analysis_overhead"];
  var events = ["user", "assistant", "tool_call", "tool_result", "skill", "usage", "compression"];
  var coverage = ["reported", "partial", "unavailable"];
  function fail(path) {
    throw new Error(`${path}: invalid report`);
  }
  function obj(value, fields2, path) {
    if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== fields2.length || fields2.some((k) => !Object.hasOwn(value, k))) fail(path);
    return value;
  }
  function arr(value, path) {
    if (!Array.isArray(value)) fail(path);
    return value;
  }
  function str(v, path) {
    if (typeof v !== "string") fail(path);
  }
  function count(v, path) {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) fail(path);
  }
  function nullable(v, check, path) {
    if (v !== null) check(v, path);
  }
  function en(v, values, path) {
    if (typeof v !== "string" || !values.includes(v)) fail(path);
  }
  function strings(v, path) {
    const a = arr(v, path);
    a.forEach((x) => str(x, path));
    return a;
  }
  function unique(v, path) {
    const ids = arr(v, path).map((x) => {
      str(objId(x, path), path + ".id");
      return objId(x, path);
    });
    const result = new Set(ids);
    if (result.size !== ids.length) fail(path);
    return result;
  }
  function objId(x, path) {
    if (x === null || typeof x !== "object" || Array.isArray(x) || !Object.hasOwn(x, "id")) fail(path);
    return x.id;
  }
  function refs(v, known, path) {
    const a = strings(v, path);
    if (a.some((id) => !known.has(id))) fail(path);
    return a;
  }
  function usage(v, path) {
    const x = obj(v, usageFields, path);
    for (const k of usageFields) nullable(x[k], count, path + "." + k);
  }
  function validateReport(value) {
    const rootFields = ["schema_version", "report", "scope", "coverage", "summary", "sessions", "metrics", "findings", "recommendations", "skill_candidates", "evidence", "analysis_usage", "privacy"];
    if (value && typeof value === "object" && Object.hasOwn(value, "provenance")) rootFields.push("provenance");
    if (value && typeof value === "object" && Object.hasOwn(value, "episodes")) rootFields.push("episodes");
    const r = obj(value, rootFields, "root");
    en(r.schema_version, ["1.0.0"], "schema_version");
    const meta = obj(r.report, ["id", "generated_at", "analyzer_version", "mode", "status", "demo"], "report");
    str(meta.id, "report.id");
    str(meta.generated_at, "report.generated_at");
    const stamp = meta.generated_at;
    const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(Z|[+-](\d\d):(\d\d))$/.exec(stamp);
    if (!match || !Number.isFinite(Date.parse(stamp))) fail("report.generated_at");
    const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
    const calendar = new Date(Date.UTC(year, month - 1, day));
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59 || Number(match[8] ?? 0) > 23 || Number(match[9] ?? 0) > 59) fail("report.generated_at");
    str(meta.analyzer_version, "report.analyzer_version");
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(meta.analyzer_version)) fail("report.analyzer_version");
    en(meta.mode, ["single_session", "multi_session"], "report.mode");
    en(meta.status, ["complete", "partial"], "report.status");
    if (typeof meta.demo !== "boolean") fail("report.demo");
    const scope = obj(r.scope, ["session_ids", "excluded_sessions"], "scope");
    const scoped = strings(scope.session_ids, "scope.session_ids");
    for (const x of arr(scope.excluded_sessions, "scope.excluded_sessions")) {
      const item = obj(x, ["id", "reason"], "excluded session");
      str(item.id, "excluded.id");
      str(item.reason, "excluded.reason");
    }
    const cov = obj(r.coverage, ["usage", "limitations"], "coverage");
    en(cov.usage, coverage, "coverage.usage");
    strings(cov.limitations, "coverage.limitations");
    const sum = obj(r.summary, ["session_count", "tool_call_count", "finding_count", "input_tokens", "output_tokens", "total_tokens"], "summary");
    for (const k of ["session_count", "tool_call_count", "finding_count"]) count(sum[k], "summary." + k);
    for (const k of ["input_tokens", "output_tokens", "total_tokens"]) nullable(sum[k], count, "summary." + k);
    const sessions = arr(r.sessions, "sessions");
    for (const x of sessions) {
      const sessionFields = ["id", "agent", "agent_version", "started_at", "ended_at", "parent_id", "relationship", "usage", "coverage", "metrics", "model_runs", "timeline"];
      if (x && typeof x === "object" && Object.hasOwn(x, "source")) sessionFields.push("source");
      const s = obj(x, sessionFields, "session");
      if (s.source !== void 0) {
        const source = obj(s.source, ["format", "fingerprint", "normalized_sha256"], "session.source");
        for (const k of Object.keys(source)) str(source[k], "session.source." + k);
      }
      str(s.id, "session.id");
      en(s.agent, ["codex", "claude_code", "hermes"], "session.agent");
      for (const k of ["agent_version", "started_at", "ended_at", "parent_id", "relationship"]) nullable(s[k], str, "session." + k);
      usage(s.usage, "session.usage");
      const fields2 = ["usage", "tools", "limitations"];
      if (s.coverage && typeof s.coverage === "object" && Object.hasOwn(s.coverage, "observations")) fields2.push("observations");
      const c = obj(s.coverage, fields2, "session.coverage");
      if (c.observations !== void 0) {
        const o = obj(c.observations, ["errors", "skill_loads", "usage_granularity", "source_context"], "observations");
        en(o.errors, coverage, "observations.errors");
        en(o.skill_loads, coverage, "observations.skill_loads");
        en(o.usage_granularity, ["request", "session", "unavailable"], "observations.usage_granularity");
        if (typeof o.source_context !== "boolean") fail("observations.source_context");
      }
      en(c.usage, coverage, "session.coverage.usage");
      en(c.tools, ["observed", "unavailable"], "session.coverage.tools");
      strings(c.limitations, "session.coverage.limitations");
      const m = obj(s.metrics, ["tool_call_count", "tool_error_count", "skill_load_count", "event_count"], "session.metrics");
      for (const k of Object.keys(m)) count(m[k], "session.metrics." + k);
      for (const x2 of arr(s.model_runs, "model_runs")) {
        const run = obj(x2, ["model", "provider"], "model_run");
        nullable(run.model, str, "model_run.model");
        nullable(run.provider, str, "model_run.provider");
      }
      for (const x2 of arr(s.timeline, "timeline")) {
        const e = obj(x2, ["event_id", "type", "timestamp", "tool_name", "source_ref"], "timeline");
        str(e.event_id, "timeline.event_id");
        en(e.type, events, "timeline.type");
        nullable(e.timestamp, str, "timeline.timestamp");
        nullable(e.tool_name, str, "timeline.tool_name");
        str(e.source_ref, "timeline.source_ref");
      }
    }
    const sids = unique(sessions, "sessions");
    if (scoped.length !== sids.size || new Set(scoped).size !== sids.size || scoped.some((id) => !sids.has(id)) || sum.session_count !== sids.size) fail("session counts or scope");
    if (sum.tool_call_count !== sessions.reduce((n, s) => n + s.metrics.tool_call_count, 0)) fail("tool call count");
    const findings = arr(r.findings, "findings"), recommendations = arr(r.recommendations, "recommendations"), candidates = arr(r.skill_candidates, "skill_candidates"), evidence = arr(r.evidence, "evidence");
    if (sum.finding_count !== findings.length) fail("finding count");
    if (cov.usage === "reported" && sessions.some((s) => s.coverage.usage !== "reported" || s.usage.total_tokens === null)) fail("reported coverage");
    if (cov.usage === "unavailable" && sessions.some((s) => s.usage.total_tokens !== null)) fail("unavailable coverage");
    const metrics = obj(r.metrics, ["tools", "skills"], "metrics");
    for (const x of arr(metrics.tools, "metrics.tools")) {
      const t = obj(x, ["name", "calls", "errors", "output_chars"], "tool metric");
      str(t.name, "tool.name");
      for (const k of ["calls", "errors", "output_chars"]) count(t[k], "tool." + k);
    }
    for (const x of arr(metrics.skills, "metrics.skills")) {
      const t = obj(x, ["name", "loads", "states"], "skill metric");
      str(t.name, "skill.name");
      count(t.loads, "skill.loads");
      for (const state of strings(t.states, "skill.states")) en(state, ["invoked", "loaded", "applied", "unknown"], "skill.state");
    }
    const evids = unique(evidence, "evidence");
    const timelines = new Map(sessions.map((x) => {
      const s = x;
      return [s.id, new Set(s.timeline.map((e) => e.event_id))];
    }));
    for (const x of evidence) {
      const e = obj(x, ["id", "session_id", "event_id", "source_ref", "description", "excerpt"], "evidence");
      for (const k of ["id", "session_id", "event_id", "source_ref", "description"]) str(e[k], "evidence." + k);
      nullable(e.excerpt, str, "evidence.excerpt");
      if (!sids.has(e.session_id) || !timelines.get(e.session_id)?.has(e.event_id)) fail("evidence reference");
    }
    const finds = unique(findings, "findings"), recs = unique(recommendations, "recommendations");
    unique(candidates, "skill_candidates");
    const evidenceSessions = new Map(evidence.map((x) => {
      const e = x;
      return [e.id, e.session_id];
    }));
    for (const x of findings) {
      const f = obj(x, ["id", "category", "rule_id", "title", "severity", "claim_type", "confidence", "session_ids", "evidence_ids", "observation", "interpretation", "recommendation_ids"], "finding");
      for (const k of ["id", "rule_id", "title", "observation", "interpretation"]) str(f[k], "finding." + k);
      en(f.category, categories, "finding.category");
      en(f.severity, ["low", "medium", "high"], "finding.severity");
      en(f.claim_type, ["observed", "inferred"], "finding.claim_type");
      en(f.confidence, ["low", "medium", "high"], "finding.confidence");
      const ss = refs(f.session_ids, sids, "finding.session_ids"), ee = refs(f.evidence_ids, evids, "finding.evidence_ids");
      refs(f.recommendation_ids, recs, "finding.recommendation_ids");
      if (ee.some((id) => !ss.includes(evidenceSessions.get(id)))) fail("finding evidence session mismatch");
    }
    for (const x of recommendations) {
      const rec = obj(x, ["id", "title", "action", "kind", "priority", "finding_ids", "overlap_group"], "recommendation");
      for (const k of ["id", "title", "action"]) str(rec[k], "recommendation." + k);
      en(rec.kind, ["skill", "script", "template", "instruction", "workflow", "investigate"], "recommendation.kind");
      en(rec.priority, ["low", "medium", "high"], "recommendation.priority");
      refs(rec.finding_ids, finds, "recommendation.finding_ids");
      nullable(rec.overlap_group, str, "recommendation.overlap_group");
    }
    for (const x of candidates) {
      const c = obj(x, ["id", "title", "trigger", "session_ids", "evidence_ids", "recommendation", "rationale", "acceptance_tests"], "candidate");
      for (const k of ["id", "title", "trigger", "rationale"]) str(c[k], "candidate." + k);
      const ss = refs(c.session_ids, sids, "candidate.session_ids"), ee = refs(c.evidence_ids, evids, "candidate.evidence_ids");
      if (ee.some((id) => !ss.includes(evidenceSessions.get(id)))) fail("candidate evidence session mismatch");
      en(c.recommendation, ["create", "extend", "merge", "defer"], "candidate.recommendation");
      strings(c.acceptance_tests, "candidate.acceptance_tests");
    }
    const analysis = obj(r.analysis_usage, ["mode", "model_tokens", "notes"], "analysis_usage");
    en(analysis.mode, ["metrics_only", "assisted"], "analysis_usage.mode");
    nullable(analysis.model_tokens, count, "analysis_usage.model_tokens");
    strings(analysis.notes, "analysis_usage.notes");
    if (r.provenance !== void 0) {
      const p = obj(r.provenance, ["analyzer", "instructions", "interpretations"], "provenance");
      const a = obj(p.analyzer, ["version", "revision", "build_sha256"], "provenance.analyzer");
      str(a.version, "analyzer.version");
      if (a.version !== meta.analyzer_version) fail("analyzer.version");
      nullable(a.revision, str, "analyzer.revision");
      str(a.build_sha256, "analyzer.build");
      const instructions = obj(p.instructions, ["skill_sha256", "guide_sha256"], "provenance.instructions");
      for (const k of Object.keys(instructions)) str(instructions[k], "instructions");
      for (const item of arr(p.interpretations, "interpretations")) {
        const i = obj(item, ["model", "instruction_sha256", "packet_sha256", "max_chars", "context_event_ids", "model_tokens"], "interpretation provenance");
        for (const k of ["model", "instruction_sha256", "packet_sha256"]) nullable(i[k], str, k);
        nullable(i.max_chars, count, "max_chars");
        nullable(i.model_tokens, count, "model_tokens");
        const eventIds = new Set(sessions.flatMap((s) => s.timeline.map((e) => e.event_id)));
        refs(i.context_event_ids, eventIds, "context_event_ids");
      }
    }
    if (r.episodes !== void 0) {
      const episodes = arr(r.episodes, "episodes");
      unique(episodes, "episodes");
      for (const entry of episodes) {
        const episodeFields = ["id", "session_id", "request_evidence_id", "action_evidence_ids", "correction_evidence_ids", "verification_evidence_ids", "evidence_ids", "boundary", "limitations", "outcome"];
        if (entry && typeof entry === "object" && Object.hasOwn(entry, "request_kind")) episodeFields.push("request_kind");
        const e = obj(entry, episodeFields, "episode");
        if (e.request_kind !== void 0) en(e.request_kind, ["task", "analyzer", "control", "unknown"], "episode.request_kind");
        str(e.id, "episode.id");
        if (!sids.has(e.session_id)) fail("episode.session_id");
        const ee = refs(e.evidence_ids, evids, "episode.evidence_ids");
        if (!ee.length || ee.some((id) => evidenceSessions.get(id) !== e.session_id)) fail("episode evidence");
        const ids = new Set(ee);
        nullable(e.request_evidence_id, (id, p) => {
          if (!ids.has(id)) fail(p);
        }, "episode.request");
        for (const k of ["action_evidence_ids", "correction_evidence_ids", "verification_evidence_ids"]) refs(e[k], ids, k);
        en(e.boundary, ["request", "partial"], "episode.boundary");
        strings(e.limitations, "episode.limitations");
        const o = obj(e.outcome, ["state", "basis", "criteria", "evidence_ids", "reviewer"], "episode.outcome");
        en(o.state, ["unknown", "claimed_complete", "verified", "failed", "blocked"], "outcome.state");
        en(o.basis, ["unassessed", "assistant_claim", "reviewer_assessment"], "outcome.basis");
        nullable(o.criteria, str, "outcome.criteria");
        nullable(o.reviewer, str, "outcome.reviewer");
        const support = refs(o.evidence_ids, ids, "outcome.evidence");
        if (o.state === "verified" && (o.basis !== "reviewer_assessment" || !o.criteria || !o.reviewer || !support.some((id) => e.verification_evidence_ids.includes(id)))) fail("verified outcome");
      }
    }
    const privacy = obj(r.privacy, ["raw_transcripts_included", "excerpts_included", "redaction_applied", "safe_to_share"], "privacy");
    if (privacy.raw_transcripts_included !== false || privacy.safe_to_share !== null || typeof privacy.excerpts_included !== "boolean" || typeof privacy.redaction_applied !== "boolean") fail("privacy");
    if (!privacy.excerpts_included && evidence.some((x) => x.excerpt !== null)) fail("excerpts not opted in");
  }

  // src/identity.ts
  function canonicalJson(value) {
    return JSON.stringify(value, (_key, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v) ?? "null";
  }
  function sha256(value) {
    const bytes = new TextEncoder().encode(value), length = bytes.length;
    const data = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
    data.set(bytes);
    data[length] = 128;
    const view = new DataView(data.buffer);
    view.setUint32(data.length - 8, Math.floor(length / 536870912));
    view.setUint32(data.length - 4, length * 8 >>> 0);
    const constants = [], initial = [];
    for (let n = 2; constants.length < 64; n++) {
      let prime = true;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) {
        prime = false;
        break;
      }
      if (prime) {
        if (initial.length < 8) initial.push(Math.sqrt(n) % 1 * 4294967296 >>> 0);
        constants.push(Math.cbrt(n) % 1 * 4294967296 >>> 0);
      }
    }
    const h = initial, w = new Uint32Array(64), rotate = (x, n) => x >>> n | x << 32 - n;
    for (let offset = 0; offset < data.length; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i++) {
        const a2 = w[i - 15], b2 = w[i - 2];
        w[i] = w[i - 16] + (rotate(a2, 7) ^ rotate(a2, 18) ^ a2 >>> 3) + w[i - 7] + (rotate(b2, 17) ^ rotate(b2, 19) ^ b2 >>> 10) >>> 0;
      }
      let [a, b, c, d, e, f, g, z] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = z + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + (e & f ^ ~e & g) + constants[i] + w[i] >>> 0;
        const t2 = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + (a & b ^ a & c ^ b & c) >>> 0;
        z = g;
        g = f;
        f = e;
        e = d + t1 >>> 0;
        d = c;
        c = b;
        b = a;
        a = t1 + t2 >>> 0;
      }
      [a, b, c, d, e, f, g, z].forEach((v, i) => {
        h[i] = h[i] + v >>> 0;
      });
    }
    return h.map((x) => x.toString(16).padStart(8, "0")).join("");
  }
  var fingerprint = (value) => sha256(canonicalJson(value));

  // src/feedback.ts
  function reportFingerprint(report) {
    const copy = structuredClone(report);
    copy.report.generated_at = "";
    return fingerprint(copy);
  }
  function createFeedback(report) {
    validateReport(report);
    return { feedback_version: "1.0.0", report_id: report.report.id, report_sha256: reportFingerprint(report), analysis_revision: structuredClone(report.provenance ?? null), entries: [] };
  }
  var object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  function fields(v, keys) {
    if (!object(v) || Object.keys(v).length !== keys.length || keys.some((k) => !Object.hasOwn(v, k))) throw new Error("Invalid feedback fields");
  }
  function text(v) {
    if (typeof v !== "string") throw new Error("Invalid feedback text");
  }
  function choice(v, values) {
    if (typeof v !== "string" || !values.includes(v)) throw new Error("Invalid feedback state");
  }
  function refs2(v, known) {
    if (!Array.isArray(v) || new Set(v).size !== v.length || v.some((id) => typeof id !== "string" || !known.has(id))) throw new Error("Unknown or duplicate feedback references");
  }
  function validateFeedback(report, value) {
    validateReport(report);
    fields(value, ["feedback_version", "report_id", "report_sha256", "analysis_revision", "entries"]);
    if (value.feedback_version !== "1.0.0" || value.report_id !== report.report.id || value.report_sha256 !== reportFingerprint(report) || fingerprint(value.analysis_revision) !== fingerprint(report.provenance ?? null)) throw new Error("Stale feedback: report identity or analysis revision changed");
    if (!Array.isArray(value.entries)) throw new Error("Feedback entries must be a list");
    const ids = /* @__PURE__ */ new Set(), superseded = /* @__PURE__ */ new Set(), findings = new Set(report.findings.map((f) => f.id)), episodes = new Set((report.episodes ?? []).map((e) => e.id)), evidence = new Set(report.evidence.map((e) => e.id));
    const previous = /* @__PURE__ */ new Map();
    for (const raw of value.entries) {
      fields(raw, ["id", "supersedes", "recommendation_id", "recommendation_sha256", "finding_ids", "episode_ids", "reviewer", "recorded_at", "review", "attempt", "follow_up"]);
      for (const k of ["id", "recommendation_id", "recommendation_sha256", "reviewer", "recorded_at"]) text(raw[k]);
      if (!raw.id || ids.has(raw.id)) throw new Error("Duplicate feedback ID");
      ids.add(raw.id);
      if (!/^\d{4}-\d\d-\d\dT/.test(raw.recorded_at) || !Number.isFinite(Date.parse(raw.recorded_at))) throw new Error("Invalid feedback timestamp");
      const rec = report.recommendations.find((r) => r.id === raw.recommendation_id);
      if (!rec || raw.recommendation_sha256 !== fingerprint(rec)) throw new Error("Stale or unknown recommendation");
      refs2(raw.finding_ids, findings);
      if (fingerprint([...raw.finding_ids].sort()) !== fingerprint([...rec.finding_ids].sort())) throw new Error("Feedback findings do not match recommendation");
      refs2(raw.episode_ids, episodes);
      const recEvidence = new Set(report.findings.filter((f) => rec.finding_ids.includes(f.id)).flatMap((f) => f.evidence_ids));
      if (raw.episode_ids.some((id) => !report.episodes.find((e) => e.id === id).evidence_ids.some((id2) => recEvidence.has(id2)))) throw new Error("Feedback episode unrelated to recommendation");
      if (raw.supersedes !== null) {
        text(raw.supersedes);
        const prior = previous.get(raw.supersedes);
        if (!prior || prior.recommendation_id !== raw.recommendation_id || superseded.has(raw.supersedes)) throw new Error("Invalid feedback revision chain");
        superseded.add(raw.supersedes);
      }
      fields(raw.review, ["decision", "evidence_sufficient", "correct", "usefulness", "reason"]);
      choice(raw.review.decision, ["accept", "reject", "defer"]);
      for (const k of ["evidence_sufficient", "correct"]) if (raw.review[k] !== null && typeof raw.review[k] !== "boolean") throw new Error("Invalid review assessment");
      if (raw.review.usefulness !== null && (!Number.isInteger(raw.review.usefulness) || Number(raw.review.usefulness) < 1 || Number(raw.review.usefulness) > 5)) throw new Error("Usefulness must be 1\u20135 or unknown");
      text(raw.review.reason);
      if (!raw.review.reason.trim()) throw new Error("Feedback reason required");
      fields(raw.attempt, ["state", "change", "correctness_test"]);
      choice(raw.attempt.state, ["not_attempted", "attempted", "unknown"]);
      text(raw.attempt.change);
      text(raw.attempt.correctness_test);
      if (raw.attempt.state === "attempted" && (!raw.attempt.change.trim() || !raw.attempt.correctness_test.trim())) throw new Error("Attempt requires a change and correctness test");
      if (raw.follow_up !== null) {
        fields(raw.follow_up, ["outcome", "basis", "correctness", "regressions", "additional_effort", "evidence_ids"]);
        choice(raw.follow_up.outcome, ["improved", "unchanged", "worse", "unknown"]);
        choice(raw.follow_up.basis, ["user_report", "observed_test", "model_inference"]);
        choice(raw.follow_up.correctness, ["preserved", "regression", "unknown"]);
        text(raw.follow_up.regressions);
        text(raw.follow_up.additional_effort);
        refs2(raw.follow_up.evidence_ids, evidence);
        if (raw.attempt.state !== "attempted") throw new Error("Follow-up requires an explicit attempt");
        if (raw.follow_up.basis === "observed_test" && !raw.follow_up.evidence_ids.length) throw new Error("Observed follow-up requires evidence");
      }
      previous.set(raw.id, raw);
    }
  }
  function appendFeedback(report, file, entry) {
    validateFeedback(report, file);
    const result = structuredClone(file);
    result.entries.push(structuredClone(entry));
    validateFeedback(report, result);
    return result;
  }
  function feedbackDraft(report, recommendationId) {
    const rec = report.recommendations.find((r) => r.id === recommendationId);
    if (!rec) throw new Error("Unknown recommendation");
    return { id: "feedback:" + globalThis.crypto.randomUUID(), supersedes: null, recommendation_id: rec.id, recommendation_sha256: fingerprint(rec), finding_ids: [...rec.finding_ids], episode_ids: [], reviewer: "anonymous", recorded_at: (/* @__PURE__ */ new Date()).toISOString(), review: { decision: "defer", evidence_sufficient: null, correct: null, usefulness: null, reason: "" }, attempt: { state: "not_attempted", change: "", correctness_test: "" }, follow_up: null };
  }

  // web/examples/codex-pages-report.json
  var codex_pages_report_default = {
    schema_version: "1.0.0",
    report: {
      id: "codex-pages-demo",
      generated_at: "2026-10-02T22:19:44.204Z",
      analyzer_version: "0.1.0",
      mode: "single_session",
      status: "partial",
      demo: true
    },
    scope: {
      session_ids: [
        "codex:pages-demo"
      ],
      excluded_sessions: []
    },
    coverage: {
      usage: "unavailable",
      limitations: [
        "Sanitized excerpt of a real repo session (2026-10-02): eight selected events; personal paths and IDs replaced. Counts cover only this excerpt. Usage snapshots omitted.",
        "Task outcomes are unknown; successful tool calls do not verify outcomes."
      ]
    },
    summary: {
      session_count: 1,
      tool_call_count: 2,
      finding_count: 1,
      input_tokens: null,
      output_tokens: null,
      total_tokens: null
    },
    sessions: [
      {
        id: "codex:pages-demo",
        agent: "codex",
        agent_version: "0.160.0",
        started_at: "2026-10-02T21:56:51.081Z",
        ended_at: "2026-10-02T22:02:13.146Z",
        parent_id: null,
        relationship: null,
        usage: {
          input_tokens: null,
          output_tokens: null,
          cache_read_tokens: null,
          cache_write_tokens: null,
          reasoning_tokens: null,
          total_tokens: null
        },
        coverage: {
          usage: "unavailable",
          tools: "observed",
          limitations: [
            "Sanitized excerpt of a real repo session (2026-10-02): eight selected events; personal paths and IDs replaced. Counts cover only this excerpt. Usage snapshots omitted."
          ]
        },
        metrics: {
          tool_call_count: 2,
          tool_error_count: 0,
          skill_load_count: 0,
          event_count: 8
        },
        model_runs: [],
        timeline: [
          {
            event_id: "codex:pages-demo:e1",
            type: "user",
            timestamp: "2026-10-02T21:59:57.992Z",
            tool_name: null,
            source_ref: "line:2"
          },
          {
            event_id: "codex:pages-demo:e2",
            type: "assistant",
            timestamp: "2026-10-02T22:00:01.717Z",
            tool_name: null,
            source_ref: "line:3"
          },
          {
            event_id: "codex:pages-demo:e3",
            type: "assistant",
            timestamp: "2026-10-02T22:00:49.868Z",
            tool_name: null,
            source_ref: "line:4"
          },
          {
            event_id: "codex:pages-demo:e4",
            type: "tool_call",
            timestamp: "2026-10-02T22:02:00.542Z",
            tool_name: "exec",
            source_ref: "line:5"
          },
          {
            event_id: "codex:pages-demo:e5",
            type: "tool_result",
            timestamp: "2026-10-02T22:02:01.732Z",
            tool_name: null,
            source_ref: "line:6"
          },
          {
            event_id: "codex:pages-demo:e6",
            type: "tool_call",
            timestamp: "2026-10-02T22:02:06.158Z",
            tool_name: "exec",
            source_ref: "line:7"
          },
          {
            event_id: "codex:pages-demo:e7",
            type: "tool_result",
            timestamp: "2026-10-02T22:02:06.252Z",
            tool_name: null,
            source_ref: "line:8"
          },
          {
            event_id: "codex:pages-demo:e8",
            type: "assistant",
            timestamp: "2026-10-02T22:02:13.146Z",
            tool_name: null,
            source_ref: "line:9"
          }
        ]
      }
    ],
    metrics: {
      tools: [
        {
          name: "exec",
          calls: 2,
          errors: 0,
          output_chars: 11671
        }
      ],
      skills: []
    },
    findings: [
      {
        id: "demo-verification",
        category: "outcome_verification",
        rule_id: "demo_verification_review",
        title: "Check the recorded build verification",
        severity: "low",
        claim_type: "observed",
        confidence: "high",
        session_ids: [
          "codex:pages-demo"
        ],
        evidence_ids: [
          "demo-start-call",
          "demo-start-result",
          "demo-call",
          "demo-result"
        ],
        observation: "The excerpt records a test/build invocation and a follow-up that collects its output.",
        interpretation: "Check evidence to compare the recorded commands and results with the closing claim. This excerpt does not establish that the site was deployed or identify an avoidable problem.",
        recommendation_ids: []
      }
    ],
    recommendations: [],
    skill_candidates: [],
    evidence: [
      {
        id: "demo-start-result",
        session_id: "codex:pages-demo",
        event_id: "codex:pages-demo:e5",
        source_ref: "line:6",
        description: "Initial output; test process still running.",
        excerpt: null
      },
      {
        id: "demo-start-call",
        session_id: "codex:pages-demo",
        event_id: "codex:pages-demo:e4",
        source_ref: "line:5",
        description: "Recorded test/build invocation.",
        excerpt: null
      },
      {
        id: "demo-call",
        session_id: "codex:pages-demo",
        event_id: "codex:pages-demo:e6",
        source_ref: "line:7",
        description: "Follow-up tool input collecting test/build output.",
        excerpt: null
      },
      {
        id: "demo-result",
        session_id: "codex:pages-demo",
        event_id: "codex:pages-demo:e7",
        source_ref: "line:8",
        description: "Recorded tool output for that follow-up.",
        excerpt: null
      }
    ],
    analysis_usage: {
      mode: "assisted",
      model_tokens: null,
      notes: [
        "Metrics computed locally from the sanitized excerpt. One editorial review observation added for the evidence demo; no actionable recommendations or savings estimates."
      ]
    },
    privacy: {
      raw_transcripts_included: false,
      excerpts_included: false,
      redaction_applied: true,
      safe_to_share: null
    }
  };

  // src/web/demo-source.json
  var demo_source_default = '{"type": "session_meta", "payload": {"id": "pages-demo", "timestamp": "2026-10-02T21:56:51.081Z", "cli_version": "0.160.0"}}\n{"timestamp": "2026-10-02T21:59:57.992Z", "type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "make sure that this repo is GitHub Pages compatible as I wanted the report page to be pretty static"}]}}\n{"timestamp": "2026-10-02T22:00:01.717Z", "type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "I\u2019ll check how the report is built and served, then make any changes needed for a static GitHub Pages deployment."}]}}\n{"timestamp": "2026-10-02T22:00:49.868Z", "type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "The viewer already uses static HTML, CSS, and browser JavaScript, with relative links that work under a GitHub Pages repository URL. Reports are read locally in the browser. I\u2019ll add a dedicated static build and Pages workflow that publishes only the viewer assets."}]}}\n{"timestamp": "2026-10-02T22:02:00.542Z", "type": "response_item", "payload": {"type": "custom_tool_call", "call_id": "demo-call-1", "name": "exec", "input": "text(await tools.apply_patch(\\"*** Begin Patch\\\\n*** Add File: /workspace/session-analysis/tests/pages.test.mts\\\\n+import test from \'node:test\';\\\\n+import assert from \'node:assert/strict\';\\\\n+import { execFileSync } from \'node:child_process\';\\\\n+import { readFileSync, readdirSync, writeFileSync } from \'node:fs\';\\\\n+import { fileURLToPath } from \'node:url\';\\\\n+\\\\n+test(\'Pages artifact excludes stale reports and resolves assets and navigation under repository paths\', () => {\\\\n+  const builder = fileURLToPath(new URL(\'../scripts/build-pages.mjs\', import.meta.url));\\\\n+  const site = new URL(\'../_site/\', import.meta.url);\\\\n+  execFileSync(process.execPath, [builder]);\\\\n+  writeFileSync(new URL(\'private-report.json\', site), \'{\\\\\\"private\\\\\\":true}\');\\\\n+  execFileSync(process.execPath, [builder]);\\\\n+  const files = readdirSync(site).sort();\\\\n+  assert.deepEqual(files, [\'.nojekyll\', \'app.js\', \'index.html\', \'setup.html\', \'style.css\']);\\\\n+  for (const base of [\'https://example.github.io/session-analysis/\', \'https://reports.example.com/\']) {\\\\n+    for (const page of [\'index.html\', \'setup.html\']) {\\\\n+      const html = readFileSync(new URL(page, site), \'utf8\');\\\\n+      for (const [, reference] of html.matchAll(/(?:href|src)=\\\\\\"([^\\\\\\"]+)\\\\\\"/g)) {\\\\n+        if (reference.startsWith(\'https://\') || reference.startsWith(\'#\')) continue;\\\\n+        const resolved = new URL(reference, new URL(page, base));\\\\n+        assert.ok(resolved.href.startsWith(base), `${reference} must stay under ${base}`);\\\\n+        assert.ok(files.includes(resolved.href.slice(base.length)), `${reference} must exist in the artifact`);\\\\n+      }\\\\n+    }\\\\n+  }\\\\n+  const script = readFileSync(new URL(\'app.js\', site), \'utf8\');\\\\n+  assert.doesNotMatch(script, /\\\\\\\\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\\\\\\\\s*\\\\\\\\(/);\\\\n+  assert.doesNotMatch(script, /\\\\\\\\b(?:localStorage|sessionStorage|indexedDB)\\\\\\\\b/);\\\\n+});\\\\n*** End Patch\\"));\\ntext(await tools.exec_command({cmd:\\"npm test; npm run build:pages; git diff --check; git status --short\\",\\"max_output_tokens\\":5000,\\"yield_time_ms\\":1000}));\\n"}}\n{"timestamp": "2026-10-02T22:02:01.732Z", "type": "response_item", "payload": {"type": "custom_tool_call_output", "call_id": "demo-call-1", "output": [{"type": "input_text", "text": "Script completed\\nWall time 1.2 seconds\\nOutput:\\n"}, {"type": "input_text", "text": "{}"}, {"type": "input_text", "text": "{\\"chunk_id\\":\\"186b41\\",\\"wall_time_seconds\\":1.001582666,\\"session_id\\":8446,\\"original_token_count\\":440,\\"output\\":\\"\\\\n> agent-session-analysis@0.2.0 test\\\\n> npm run build && node --test tests/*.test.mts\\\\n\\\\n\\\\n> agent-session-analysis@0.2.0 build\\\\n> tsc -p tsconfig.json && tsc -p tsconfig.viewer.json && esbuild src/web/app.ts --bundle --format=iife --platform=browser --target=es2022 --outfile=web/app.js\\\\n\\\\n\\\\n  web/app.js  36.4kb\\\\n\\\\n\u26A1 Done in 9ms\\\\n\u2714 Claude native fixture normalizes cache-inclusive input and source references (2.343125ms)\\\\n\u2714 Claude deduplicates UUID and message usage while linking skills and tool results (2.433ms)\\\\n\u2714 partial Claude usage retains known subtotals but not total (0.809709ms)\\\\n\u2714 Claude skips preamble and warns with reference only (0.763417ms)\\\\n\u2714 Claude metadata user records do not become repeatable user requests (1.071083ms)\\\\n\u2714 Claude groups ignored record warnings by safe type instead of one per line (0.809708ms)\\\\n\u2714 Codex rollout uses latest cumulative snapshot and observes native calls and skill reads (1.385542ms)\\\\n\u2714 Codex exec counts each completed turn and completed command only (1.966625ms)\\\\n\u2714 Hermes SQLite introspects native columns, closes read-only and preserves counters (7.949458ms)\\\\n\u2714 Hermes sparse schema preserves parent, missing counters, unknown roles (4.54325ms)\\\\n\u2714 Hermes historical role-message JSONL requires explicit selection (1.58925ms)\\\\n\u2714 malformed final JSONL is warned, malformed interior and initial lines rejected without private text (1.507542ms)\\\\n\u2714 explicit mismatch, unsupported source and directory traversal reject correctly (5.10925ms)\\\\n\u2714 invalid agent errors never echo attacker-controlled input (0.551459ms)\\\\n\u2714 Codex cumulative partial usage retains known values without claiming total (1.57925ms)\\\\n\u2714 discover checks names only, root override, filters and environment override (12.460958ms)\\\\n\\"}"}]}}\n{"timestamp": "2026-10-02T22:02:06.158Z", "type": "response_item", "payload": {"type": "custom_tool_call", "call_id": "demo-call-2", "name": "exec", "input": "text(await tools.write_stdin({session_id:8446,chars:\\"\\",yield_time_ms:1000,max_output_tokens:5000}));\\ntext(await tools.exec_command({cmd:\\"git diff --stat; git diff -- package.json .gitignore README.md; ls -la _site\\",\\"max_output_tokens\\":3500}));\\n"}}\n{"timestamp": "2026-10-02T22:02:06.252Z", "type": "response_item", "payload": {"type": "custom_tool_call_output", "call_id": "demo-call-2", "output": [{"type": "input_text", "text": "Script completed\\nWall time 0.1 seconds\\nOutput:\\n"}, {"type": "input_text", "text": "{\\"chunk_id\\":\\"84971f\\",\\"wall_time_seconds\\":0.000012,\\"exit_code\\":0,\\"original_token_count\\":1258,\\"output\\":\\"\u2714 CLI exposes all local workflow commands (62.710417ms)\\\\n\u2714 missing report produces concise error, not a stack trace (45.666208ms)\\\\n\u2714 directory import cannot write over its own source file (48.482625ms)\\\\n\u2714 directory import cannot write into nested new directories through a symlink (44.237333ms)\\\\n\u2714 unknown usage remains null and known zero remains zero; duplicate identities are excluded (5.601084ms)\\\\n\u2714 linked errors, large results, repeated calls and skill loads are evidenced without transcript leakage (253.042833ms)\\\\n\u2714 large source read stays evidenced without automatic recommendations or cost claims (0.426208ms)\\\\n\u2714 recurring requests are deferred, inferred candidates with evidence in both sessions (1.201208ms)\\\\n\u2714 session controls are retained in the timeline but never become recurring workflow candidates (0.61475ms)\\\\n\u2714 contiguous identical explicit failures form one review-only sequence with recovery evidence (0.439292ms)\\\\n\u2714 single failed call followed by same-call explicit non-error result retains recovery evidence as Activity (0.226584ms)\\\\n\u2714 single explicit error with empty text still retains exact retry recovery evidence (0.169125ms)\\\\n\u2714 single failure does not claim recovery from an unknown result or across an intervening action (0.96ms)\\\\n\u2714 changed command, tool, error text or intervening action cannot establish repeated failure (8.679167ms)\\\\n\u2714 unknown results do not claim explicit recovery for an established failure episode (0.289125ms)\\\\n\u2714 separate retry episodes stay separate and ambiguous parallel results do not qualify (0.510375ms)\\\\n\u2714 model runs, limitations, and partial known subtotals retain provenance (0.464333ms)\\\\n\u2714 provider-only events do not create phantom model switches (0.38ms)\\\\n\u2714 reported coverage is downgraded when reported session total is missing (0.158417ms)\\\\n\u2714 ignored source records keep reported usage but make overall coverage partial (0.145667ms)\\\\n\u2714 packet fits serialized character budget and never includes dangling findings (0.434708ms)\\\\n\u2714 manual merge accepts only evidenced inferred additions without mutating original (0.646834ms)\\\\n\u2714 offline export inlines assets once and safely embeds JSON (5.392208ms)\\\\n\u2714 three native adapters analyze, validate, packet, and export offline HTML (214.624042ms)\\\\n\u2714 Pages artifact excludes stale reports and resolves assets and navigation under repository paths (101.61425ms)\\\\n\u2714 generated report matches schema root and validates (6.49575ms)\\\\n\u2714 rejects unexpected fields, invalid timestamps, versions, enums, counts, and null contradictions (1.778916ms)\\\\n\u2714 all cross references and evidence ownership must resolve (1.040125ms)\\\\n\u2714 candidate evidence must belong to declared session (0.28275ms)\\\\n\u2714 offline shell and public API validate and safely import reports (29.591833ms)\\\\n\u2714 DOM displays evidence as text, inspect timeline, preserve unknown totals and privacy (1.738708ms)\\\\n\u2714 ordinary activity never becomes advice, including legacy reports with automatic recommendations (0.31775ms)\\\\n\u2714 investigation is review-only while specific evidenced interventions appear as suggestions (0.472ms)\\\\n\u2714 source inspector opens the exact Claude call and result from selected local JSONL without embedding them in the report (3.524833ms)\\\\n\u2714 local source inspection rejects a different Claude session and does not display its contents (0.230542ms)\\\\n\u2714 closing or replacing the report discards a pending local source read (3.616708ms)\\\\n\u2714 source drilldown explains reads and includes bounded surrounding intent and next action (0.611917ms)\\\\n\u2714 recurring request evidence can inspect its actual local user message without importing injected metadata (0.179625ms)\\\\n\u2714 read descriptions distinguish native ranges from shell flags and malformed syntax (0.275ms)\\\\n\u2714 source drilldown does not guess complex shell intent or cross session boundaries (0.150208ms)\\\\n\u2714 inspector shows unique known models instead of alternating unavailable placeholders (0.287875ms)\\\\n\u2714 repeated diagnostics are grouped by meaning without discarding occurrences or evidence (0.483958ms)\\\\n\u2714 embedded report, filter and clear keep scope and report-wide metrics (0.316292ms)\\\\n\u2714 drop import enforces size before reading and reports invalid JSON (1.767791ms)\\\\n\u2714 demo is labeled synthetic and resets filter (0.318458ms)\\\\n\u2714 browser module attaches API and initializes once DOM is ready (3.077083ms)\\\\n\u2714 local file viewer boots its compiled script and the demo button renders (2.895417ms)\\\\n\u2139 tests 63\\\\n\u2139 suites 0\\\\n\u2139 pass 63\\\\n\u2139 fail 0\\\\n\u2139 cancelled 0\\\\n\u2139 skipped 0\\\\n\u2139 todo 0\\\\n\u2139 duration_ms 451.147041\\\\n\\\\n> agent-session-analysis@0.2.0 build:pages\\\\n> npm run build:viewer && node scripts/build-pages.mjs\\\\n\\\\n\\\\n> agent-session-analysis@0.2.0 build:viewer\\\\n> tsc -p tsconfig.viewer.json && esbuild src/web/app.ts --bundle --format=iife --platform=browser --target=es2022 --outfile=web/app.js\\\\n\\\\n\\\\n  web/app.js  36.4kb\\\\n\\\\n\u26A1 Done in 3ms\\\\nStatic viewer built in _site/\\\\n M .gitignore\\\\n M README.md\\\\n M package.json\\\\n?? .github/\\\\n?? scripts/\\\\n?? tests/pages.test.mts\\\\n\\"}"}, {"type": "input_text", "text": "{\\"chunk_id\\":\\"5fa706\\",\\"wall_time_seconds\\":0.000007292,\\"exit_code\\":0,\\"original_token_count\\":995,\\"output\\":\\" .gitignore   |  1 +\\\\n README.md    | 15 ++++++++++++++-\\\\n package.json |  2 ++\\\\n 3 files changed, 17 insertions(+), 1 deletion(-)\\\\ndiff --git a/.gitignore b/.gitignore\\\\nindex 214eade..1ea04de 100644\\\\n--- a/.gitignore\\\\n+++ b/.gitignore\\\\n@@ -1,4 +1,5 @@\\\\n node_modules/\\\\n dist/\\\\n+_site/\\\\n .DS_Store\\\\n *.tsbuildinfo\\\\ndiff --git a/README.md b/README.md\\\\nindex 5292201..6e9e8d1 100644\\\\n--- a/README.md\\\\n+++ b/README.md\\\\n@@ -17,7 +17,20 @@ npx --no-install session-analysis validate report.json\\\\n npx --no-install session-analysis export report.json -o report.html\\\\n ```\\\\n \\\\n-Open `report.html` directly. Alternatively, open `web/index.html` and drop a generated JSON report. The same web directory is a static site suitable for static hosting; this repository does not publish anything automatically. The website reads report files in the browser, not on a server.\\\\n+Open `report.html` directly. Alternatively, open `web/index.html` and drop a generated JSON report. The website reads report files in the browser, not on a server.\\\\n+\\\\n+## GitHub Pages\\\\n+\\\\n+The report viewer is entirely static: HTML, CSS, and browser JavaScript, with no backend or runtime Node requirement. Reports and source logs selected in the viewer stay in browser memory. Analysis still runs locally through the CLI.\\\\n+\\\\n+```sh\\\\n+npm ci\\\\n+npm run build:pages\\\\n+```\\\\n+\\\\n+Publish the generated `_site/` directory to any static host. It contains only `index.html`, `setup.html`, `style.css`, `app.js`, and `.nojekyll`; the build recreates this directory to discard stale files. Reports, logs, fixtures, and CLI code are excluded. Relative asset and navigation URLs support both a repository path such as `/session-analysis/` and a custom domain, without rewrites or base-path configuration. The existing offline viewer and exported HTML continue to work.\\\\n+\\\\n+For GitHub Pages, select **Settings \u2192 Pages \u2192 Build and deployment \u2192 Source \u2192 GitHub Actions** ([GitHub setup documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)). The included `.github/workflows/pages.yml` tests and builds on pushes and pull requests, then publishes on default-branch pushes or a manual run on the default branch. Allow that branch in the `github-pages` environment\'s deployment rules. No GitHub settings are changed by the local build.\\\\n \\\\n For Claude Code tool or request evidence, expand an observation\'s Evidence list (ordinary reads are in the collapsed **Activity** section), click **Inspect source**, and choose the matching session `.jsonl` (up to 20 MiB). User/assistant text evidence can be viewed locally too; injected metadata is rejected. For tool evidence, the local inspector shows:\\\\n - A readable description for supported literal `cat`/`sed` reads or a native `Read` input; otherwise the original tool input, without guessing intent or running commands.\\\\ndiff --git a/package.json b/package.json\\\\nindex 5e98b07..126dc6f 100644\\\\n--- a/package.json\\\\n+++ b/package.json\\\\n@@ -21,6 +21,8 @@\\\\n     \\\\\\"README.md\\\\\\"\\\\n   ],\\\\n   \\\\\\"scripts\\\\\\": {\\\\n+    \\\\\\"build:viewer\\\\\\": \\\\\\"tsc -p tsconfig.viewer.json && esbuild src/web/app.ts --bundle --format=iife --platform=browser --target=es2022 --outfile=web/app.js\\\\\\",\\\\n+    \\\\\\"build:pages\\\\\\": \\\\\\"npm run build:viewer && node scripts/build-pages.mjs\\\\\\",\\\\n     \\\\\\"build\\\\\\": \\\\\\"tsc -p tsconfig.json && tsc -p tsconfig.viewer.json && esbuild src/web/app.ts --bundle --format=iife --platform=browser --target=es2022 --outfile=web/app.js\\\\\\",\\\\n     \\\\\\"check\\\\\\": \\\\\\"tsc -p tsconfig.json --noEmit && tsc -p tsconfig.viewer.json --noEmit\\\\\\",\\\\n     \\\\\\"test\\\\\\": \\\\\\"npm run build && node --test tests/*.test.mts\\\\\\"\\\\ntotal 144\\\\ndrwxr-xr-x@  7 admin  staff    224 Oct  3 00:02 .\\\\ndrwxr-xr-x  22 admin  staff    704 Oct  3 00:02 ..\\\\n-rw-r--r--@  1 admin  staff      0 Oct  3 00:02 .nojekyll\\\\n-rw-r--r--@  1 admin  staff  37264 Oct  3 00:02 app.js\\\\n-rw-r--r--@  1 admin  staff   6180 Oct  3 00:02 index.html\\\\n-rw-r--r--@  1 admin  staff   4823 Oct  3 00:02 setup.html\\\\n-rw-r--r--@  1 admin  staff  12689 Oct  3 00:02 style.css\\\\n\\"}"}]}}\n{"timestamp": "2026-10-02T22:02:13.146Z", "type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "The repo is ready for GitHub Pages. Added a static build and deployment workflow that publishes only viewer assets; reports stay in browser memory.\\n\\nAll 63 tests pass, including repository-path links and exclusion of stale reports.\\n\\nTo enable publishing, set **Settings \u2192 Pages \u2192 Source \u2192 GitHub Actions**, then push these changes to the default branch. [GitHub setup guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)."}]}}\n';

  // src/web/app.ts
  var root = typeof window === "undefined" ? void 0 : window;
  var object2 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  var string = (v) => typeof v === "string";
  var count2 = (v) => Number.isSafeInteger(v) && v >= 0;
  var nullableString = (v) => v === null || string(v);
  var token = (v) => v === null || count2(v);
  var list = (check) => (v) => Array.isArray(v) && v.every(check);
  var oneOf = (values) => (v) => values.includes(v);
  var usage2 = { input_tokens: token, output_tokens: token, cache_read_tokens: token, cache_write_tokens: token, reasoning_tokens: token, total_tokens: token };
  function validateReport2(value) {
    const errors = [];
    function shape(v, fields2, at) {
      if (!object2(v)) {
        errors.push(at + " must be an object.");
        return;
      }
      for (const [key, check] of Object.entries(fields2)) if (!check(v[key])) errors.push(at + "." + key + " is missing or invalid.");
    }
    function rows(v, fields2, at) {
      if (Array.isArray(v)) v.forEach((item, i) => shape(item, fields2, at + "[" + i + "]"));
    }
    const strings2 = list(string), array = Array.isArray;
    shape(value, { schema_version: (v) => v === "1.0.0", report: object2, scope: object2, coverage: object2, summary: object2, sessions: array, metrics: object2, findings: array, recommendations: array, skill_candidates: array, evidence: array, analysis_usage: object2, privacy: object2 }, "Report");
    if (!object2(value)) return errors;
    shape(value.report, { id: string, generated_at: (v) => string(v) && Number.isFinite(Date.parse(v)), analyzer_version: string, mode: oneOf(["single_session", "multi_session"]), status: oneOf(["complete", "partial"]), demo: (v) => typeof v === "boolean" }, "report");
    shape(value.scope, { session_ids: strings2, excluded_sessions: list(object2) }, "scope");
    const coverage2 = { usage: oneOf(["reported", "partial", "unavailable"]), limitations: strings2 };
    shape(value.coverage, coverage2, "coverage");
    shape(value.summary, { session_count: count2, tool_call_count: count2, finding_count: count2, input_tokens: token, output_tokens: token, total_tokens: token }, "summary");
    shape(value.metrics, { tools: array, skills: array }, "metrics");
    if (object2(value.metrics)) {
      rows(value.metrics.tools, { name: string, calls: count2, errors: count2, output_chars: count2 }, "metrics.tools");
      rows(value.metrics.skills, { name: string, loads: count2, states: strings2 }, "metrics.skills");
    }
    rows(value.sessions, { id: string, agent: oneOf(["claude_code", "codex", "hermes"]), agent_version: nullableString, started_at: nullableString, ended_at: nullableString, parent_id: nullableString, relationship: nullableString, usage: object2, coverage: object2, metrics: object2, model_runs: array, timeline: array }, "sessions");
    if (Array.isArray(value.sessions)) value.sessions.forEach((s, i) => {
      if (!object2(s)) return;
      shape(s.usage, usage2, "sessions[" + i + "].usage");
      shape(s.coverage, { ...coverage2, tools: oneOf(["observed", "unavailable"]) }, "sessions[" + i + "].coverage");
      shape(s.metrics, { tool_call_count: count2, tool_error_count: count2, skill_load_count: count2, event_count: count2 }, "sessions[" + i + "].metrics");
      rows(s.model_runs, { model: nullableString, provider: nullableString }, "model_runs");
      rows(s.timeline, { event_id: string, type: string, timestamp: nullableString, tool_name: nullableString, source_ref: string }, "timeline");
    });
    rows(value.findings, { id: string, category: string, rule_id: string, title: string, severity: oneOf(["low", "medium", "high"]), claim_type: oneOf(["observed", "inferred"]), confidence: oneOf(["low", "medium", "high"]), session_ids: strings2, evidence_ids: strings2, observation: string, interpretation: string, recommendation_ids: strings2 }, "findings");
    rows(value.recommendations, { id: string, title: string, action: string, kind: oneOf(["skill", "script", "template", "instruction", "workflow", "investigate"]), priority: oneOf(["low", "medium", "high"]), finding_ids: strings2, overlap_group: nullableString }, "recommendations");
    rows(value.skill_candidates, { id: string, title: string, trigger: string, session_ids: strings2, evidence_ids: strings2, recommendation: oneOf(["create", "extend", "merge", "defer"]), rationale: string, acceptance_tests: strings2 }, "skill_candidates");
    rows(value.evidence, { id: string, session_id: string, event_id: string, source_ref: string, description: string, excerpt: nullableString }, "evidence");
    shape(value.analysis_usage, { mode: oneOf(["metrics_only", "assisted"]), model_tokens: token, notes: strings2 }, "analysis_usage");
    shape(value.privacy, { raw_transcripts_included: (v) => v === false, excerpts_included: (v) => typeof v === "boolean", redaction_applied: (v) => typeof v === "boolean", safe_to_share: (v) => v === null }, "privacy");
    return errors;
  }
  var MAX_FILE_BYTES = 20 * 1024 * 1024;
  var sourceTypes = /* @__PURE__ */ new Set(["tool_call", "tool_result", "user", "assistant"]);
  function describeToolInput(name, input) {
    if (!object2(input)) return "";
    if (name === "Read" && string(input.file_path)) {
      const offset = count2(input.offset) && input.offset > 0 ? input.offset : 1;
      return count2(input.limit) && input.limit > 0 ? `Read up to ${input.limit} lines starting at line ${offset}: ${input.file_path}` : input.offset === void 0 ? `Read file (tool may limit output): ${input.file_path}` : `Read from line ${offset}: ${input.file_path}`;
    }
    if (name !== "Bash" || !string(input.command)) return "";
    const path = `(?:[A-Za-z0-9_./-]+|"[A-Za-z0-9_./ -]+"|'[A-Za-z0-9_./ -]+')`;
    const segments = input.command.trim().split(/\s*&&\s*/);
    const descriptions = segments.map((segment) => {
      const literalPath = (value) => value.replace(/^["']|["']$/g, "");
      let match = new RegExp(`^cat\\s+(${path})$`).exec(segment);
      if (match) return literalPath(match[1]).startsWith("-") ? null : `Read whole file: ${literalPath(match[1])}`;
      match = new RegExp(`^sed\\s+-n\\s+(['"]?)(\\d+),(\\d+)p\\1\\s+(${path})$`).exec(segment);
      if (match && Number(match[2]) > 0 && Number(match[3]) >= Number(match[2]) && !literalPath(match[4]).startsWith("-")) return `Read lines ${match[2]}\u2013${match[3]}: ${literalPath(match[4])}`;
      return null;
    });
    return descriptions.every(Boolean) ? descriptions.join("\n") : "";
  }
  function inspectClaudeLog(text2, sessionId, targets, size) {
    if (size !== void 0 && size > MAX_FILE_BYTES || new TextEncoder().encode(text2).length > MAX_FILE_BYTES) throw new Error("Source log exceeds the 20 MiB import limit.");
    if (!sessionId.startsWith("claude_code:") || !targets.length) throw new Error("Select Claude Code tool evidence first.");
    const rows = text2.split("\n");
    const seenCalls = /* @__PURE__ */ new Set();
    const seenResults = /* @__PURE__ */ new Set();
    if (targets.length > 40) throw new Error("Select at most 40 source events at a time.");
    const entries = targets.map((target) => {
      const match = /^line:([1-9]\d*)$/.exec(target.source_ref);
      if (!match || !sourceTypes.has(target.type)) throw new Error("Invalid source reference.");
      const line = Number(match[1]);
      if (!Number.isSafeInteger(line) || !rows[line - 1]) throw new Error(`Source line ${line} is missing from the selected file.`);
      let record;
      try {
        record = JSON.parse(rows[line - 1]);
      } catch {
        throw new Error(`Source line ${line} is not valid JSON.`);
      }
      if (!object2(record) || record.sessionId !== sessionId.slice("claude_code:".length)) throw new Error(`Source line ${line} belongs to a different session.`);
      if (target.type === "user" || target.type === "assistant") {
        if (record.isMeta === true) throw new Error("Injected metadata is not a user request.");
        const body = textOf(record);
        if (record.type !== target.type || !body) throw new Error(`Source line ${line} does not contain the expected ${target.type} text.`);
        return { line, title: `line ${line} \xB7 ${target.type === "user" ? "user request" : "assistant context"}`, content: body.slice(0, 4e3), truncated: body.length > 4e3 };
      }
      const role = target.type === "tool_call" ? "assistant" : "user";
      const blockType = target.type === "tool_call" ? "tool_use" : "tool_result";
      const blocks = object2(record.message) && Array.isArray(record.message.content) ? record.message.content.filter((b) => object2(b) && b.type === blockType) : [];
      if (record.type !== role || !blocks.length) throw new Error(`Source line ${line} does not contain the expected ${target.type}.`);
      const parts = blocks.map((block) => {
        if (target.type === "tool_call") {
          if (string(block.id)) seenCalls.add(block.id);
          const description = describeToolInput(block.name, block.input);
          const command = object2(block.input) && string(block.input.command) ? `Command (not executed):
${block.input.command}

` : "";
          return `${description ? description + "\n\n" : ""}${string(block.name) ? block.name : "Unnamed tool"} \xB7 input
${command}${JSON.stringify(block.input ?? {}, null, 2)}`;
        }
        if (string(block.tool_use_id)) seenResults.add(block.tool_use_id);
        const value = block.content;
        const output = string(value) ? value : Array.isArray(value) ? value.map((part) => object2(part) && part.type === "text" && string(part.text) ? part.text : "[Non-text content omitted]").join("\n") : JSON.stringify(value ?? "");
        return `Tool result${block.is_error === true ? " \xB7 error" : ""}
${output}`;
      }).join("\n\n");
      const limit = 1e5;
      return { line, title: `line ${line} \xB7 ${target.type === "tool_call" ? "tool call" : "tool result"}`, content: parts.slice(0, limit), truncated: parts.length > limit };
    });
    if (seenCalls.size && seenResults.size && [...seenResults].some((id) => !seenCalls.has(id))) throw new Error("The selected tool result does not match the selected call.");
    const first = Math.min(...entries.map((e) => e.line)), last = Math.max(...entries.map((e) => e.line));
    function recordAt(line) {
      try {
        const row = JSON.parse(rows[line - 1] ?? "");
        return object2(row) ? row : null;
      } catch {
        return null;
      }
    }
    function textOf(record) {
      if (!object2(record.message)) return "";
      const content = record.message.content;
      return string(content) ? content : Array.isArray(content) ? content.filter((b) => object2(b) && b.type === "text" && string(b.text)).map((b) => b.text).join("\n") : "";
    }
    function bounded(line, title, content) {
      return { line, title, content: content.slice(0, 4e3), truncated: content.length > 4e3 };
    }
    const context = [];
    let request, explanation;
    for (let line = first; line >= Math.max(1, first - 100); line--) {
      const row = recordAt(line);
      if (!row) continue;
      if (string(row.sessionId) && row.sessionId !== sessionId.slice("claude_code:".length)) break;
      if (row.sessionId !== sessionId.slice("claude_code:".length) || row.isMeta === true) continue;
      const body = textOf(row);
      if (row.type === "assistant" && body && !explanation) explanation = bounded(line, `line ${line} \xB7 Preceding assistant context`, body);
      if (row.type === "user" && body) {
        request = bounded(line, `line ${line} \xB7 Preceding user request`, body);
        break;
      }
    }
    if (request) {
      if (!targets.some((target) => target.type === "user" && target.source_ref === `line:${request.line}`)) context.push(request);
    } else context.push(bounded(first, "Context limitation", "Preceding user request not found in the bounded context window (up to 100 source lines)."));
    if (explanation) context.push(explanation);
    let next;
    for (let line = last + 1; line <= Math.min(rows.length, last + 20); line++) {
      const row = recordAt(line);
      if (!row) continue;
      if (string(row.sessionId) && row.sessionId !== sessionId.slice("claude_code:".length)) break;
      if (row.sessionId !== sessionId.slice("claude_code:".length) || row.isMeta === true) continue;
      if (row.type === "user" && textOf(row)) break;
      if (row.type !== "assistant" || !object2(row.message)) continue;
      const blocks = Array.isArray(row.message.content) ? row.message.content : [];
      const tools = blocks.filter((b) => object2(b) && b.type === "tool_use").map((b) => `${b.name || "Unnamed tool"} \xB7 input
${JSON.stringify(b.input ?? {}, null, 2)}`).join("\n");
      const body = [textOf(row), tools].filter(Boolean).join("\n");
      if (body) {
        next = bounded(line, `line ${line} \xB7 Next recorded action (not a verified outcome)`, body);
        break;
      }
    }
    return [...context, ...entries, ...next ? [next] : [bounded(last, "Context limitation", "Next action not found within 20 source lines, or a new user request/session boundary intervened.")]];
  }
  function inspectCodexLog(text2, sessionId, targets, size) {
    if (size !== void 0 && size > MAX_FILE_BYTES || new TextEncoder().encode(text2).length > MAX_FILE_BYTES) throw new Error("Source log exceeds the 20 MiB import limit.");
    if (!sessionId.startsWith("codex:") || !targets.length || targets.length > 40) throw new Error("Select 1\u201340 Codex source events.");
    const rows = text2.split("\n").map((row) => {
      try {
        const value = JSON.parse(row);
        return object2(value) ? value : null;
      } catch {
        return null;
      }
    });
    const metadata = rows.filter((row) => row?.type === "session_meta");
    if (metadata.length !== 1 || !object2(metadata[0].payload) || (metadata[0].payload.id ?? metadata[0].payload.session_id) !== sessionId.slice(6)) throw new Error("The selected file belongs to a different session or is not a Codex rollout.");
    const payloadAt = (line) => {
      const row = rows[line - 1];
      return row?.type === "response_item" && object2(row.payload) ? row.payload : null;
    };
    const body = (p) => Array.isArray(p.content) ? p.content.filter((b) => object2(b) && ["input_text", "output_text", "text"].includes(b.type) && string(b.text)).map((b) => b.text).join("\n") : "";
    const resultText = (value) => {
      try {
        const response = JSON.parse(value);
        if (object2(response) && string(response.output)) {
          const { output, ...metadata2 } = response;
          return `Recorded response metadata: ${JSON.stringify(metadata2)}
${output}`;
        }
      } catch {
      }
      return value;
    };
    const isText = (p, role) => p.type === "message" && p.role === role && !!body(p) && !/^\s*<(?:environment_context|INSTRUCTIONS|permissions|skills_instructions)\b/i.test(body(p));
    const calls = /* @__PURE__ */ new Set(), results = /* @__PURE__ */ new Set();
    const bounded = (line, title, content, limit = 4e3) => ({ line, title: `line ${line} \xB7 ${title}`, content: content.slice(0, limit), truncated: content.length > limit });
    const entries = targets.map((target) => {
      const match = /^line:([1-9]\d*)$/.exec(target.source_ref);
      if (!match || !sourceTypes.has(target.type)) throw new Error("Invalid source reference.");
      const line = Number(match[1]), p = payloadAt(line);
      if (!Number.isSafeInteger(line) || !p) throw new Error(`Source line ${line} is missing or is not a response item.`);
      if (target.type === "user" || target.type === "assistant") {
        if (!isText(p, target.type)) throw new Error(`Source line ${line} does not contain expected text (injected metadata is excluded).`);
        return bounded(line, target.type, body(p));
      }
      const call = target.type === "tool_call";
      if (!(call ? ["function_call", "custom_tool_call"] : ["function_call_output", "custom_tool_call_output"]).includes(p.type) || !string(p.call_id) || !p.call_id) throw new Error(`Source line ${line} does not contain the expected ${target.type} with a call ID.`);
      (call ? calls : results).add(p.call_id);
      const output = Array.isArray(p.output) ? p.output.map((b) => object2(b) && string(b.text) ? resultText(b.text) : "[Non-text content omitted]").join("\n") : string(p.output) ? resultText(p.output) : JSON.stringify(p.output ?? "");
      return bounded(line, call ? "tool call" : "tool result", call ? `${p.name || "Unnamed tool"} \xB7 input (not executed)
${p.arguments ?? p.input ?? ""}` : `Tool result
${output}`, 1e5);
    });
    if (calls.size && results.size && [...results].some((id) => !calls.has(id))) throw new Error("The selected tool result does not match the selected call.");
    const first = Math.min(...entries.map((e) => e.line)), last = Math.max(...entries.map((e) => e.line));
    const context = [];
    let request, explanation, next;
    for (let line = first - 1; line >= Math.max(1, first - 100); line--) {
      const p = payloadAt(line);
      if (!p) continue;
      if (isText(p, "assistant") && !explanation) explanation = bounded(line, "Preceding assistant context", body(p));
      if (isText(p, "user")) {
        request = bounded(line, "Preceding user request", body(p));
        break;
      }
    }
    context.push(request ?? bounded(first, "Context limitation", "Preceding user request not found within 100 source lines."));
    if (explanation) context.push(explanation);
    for (let line = last + 1; line <= Math.min(rows.length, last + 20); line++) {
      const p = payloadAt(line);
      if (!p) continue;
      if (p.type === "message" && p.role === "user") break;
      if (isText(p, "assistant")) {
        next = bounded(line, "Next recorded assistant context (not a verified outcome)", body(p));
        break;
      }
      if (["function_call", "custom_tool_call"].includes(p.type)) {
        next = bounded(line, "Next recorded action (not a verified outcome)", `${p.name}
${p.arguments ?? p.input ?? ""}`);
        break;
      }
    }
    return [...context, ...entries, next ?? bounded(last, "Context limitation", "Next action not found within 20 source lines, or a new user request intervened.")];
  }
  var demoReport = codex_pages_report_default;
  function parseReport(text2, size) {
    if (size !== void 0 && size > MAX_FILE_BYTES || new TextEncoder().encode(text2).length > MAX_FILE_BYTES) throw new Error("Report exceeds the 20 MiB import limit.");
    let value;
    try {
      value = JSON.parse(text2);
    } catch (_) {
      throw new Error("Invalid JSON. Choose an exported Session Analysis report.");
    }
    const errors = validateReport2(value);
    if (errors.length) throw new Error(errors.slice(0, 8).join("\n"));
    return value;
  }
  function selectScope(report, agent) {
    const sessions = report.sessions.filter((s) => agent === "all" || s.agent === agent);
    const ids = new Set(sessions.map((s) => s.id));
    const included = (item) => agent === "all" || item.session_ids.some((id) => ids.has(id));
    return { sessions, findings: report.findings.filter(included), candidates: report.skill_candidates.filter(included) };
  }
  function formatNumber(value) {
    return value === null || value === void 0 ? "Unavailable" : Number(value).toLocaleString("en-US");
  }
  var platformChoices = /* @__PURE__ */ new WeakMap();
  function detectPlatform(nav) {
    const value = nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || "";
    if (/Windows|Win32|Win64/i.test(value)) return "windows";
    if (/Mac/i.test(value)) return "mac";
    if (/Linux|X11/i.test(value)) return "linux";
    return "unknown";
  }
  function currentPlatform(doc) {
    return platformChoices.get(doc) ?? detectPlatform(doc.defaultView?.navigator);
  }
  function copyButton(doc, parent, value, label = value) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "copy-path";
    button.textContent = label;
    button.setAttribute("aria-label", `Copy ${value}`);
    button.title = `Copy ${value}`;
    const feedback = doc.createElement("span");
    feedback.className = "copy-feedback muted";
    feedback.setAttribute("role", "status");
    let feedbackTimer;
    let feedbackClearTimer;
    const showFeedback = (message) => {
      if (feedbackTimer !== void 0) clearTimeout(feedbackTimer);
      if (feedbackClearTimer !== void 0) clearTimeout(feedbackClearTimer);
      feedback.textContent = message;
      feedback.classList.add("visible");
      feedbackTimer = setTimeout(() => {
        feedback.classList.remove("visible");
        feedbackTimer = void 0;
        feedbackClearTimer = setTimeout(() => {
          feedback.textContent = "";
          feedbackClearTimer = void 0;
        }, 250);
      }, 2e3);
    };
    button.onclick = () => {
      void (async () => {
        try {
          const clipboard = doc.defaultView?.navigator.clipboard;
          if (!clipboard) throw new Error("Clipboard unavailable");
          await clipboard.writeText(value);
          showFeedback("Copied");
        } catch {
          showFeedback("Select and copy the text shown.");
        }
      })();
    };
    parent.append(button, feedback);
    return button;
  }
  function pathGuide(doc, parent, agent) {
    const platform = currentPlatform(doc), windows = platform === "windows";
    const p = doc.createElement("p");
    p.textContent = platform === "mac" ? "macOS: press \u2318\u21E7G in the file or folder picker, then paste a path below. \u2318\u21E7. toggles hidden files." : windows ? "Windows: click the address bar in the file or folder picker (Alt+D), then paste a path below and press Enter." : platform === "linux" ? "Linux: in most file pickers, press Ctrl+L, then paste a path below and press Enter. Ctrl+H usually toggles hidden files." : "Choose your platform above for file-picker instructions. Copy a default path below to locate session logs.";
    parent.append(p);
    const paths = [];
    if (!agent || agent === "claude_code") paths.push(["Claude Code", windows ? "%USERPROFILE%\\.claude\\projects\\" : "~/.claude/projects/"]);
    if (!agent || agent === "codex") paths.push(["Codex", windows ? "%USERPROFILE%\\.codex\\sessions\\" : "~/.codex/sessions/"], ["Codex archive", windows ? "%USERPROFILE%\\.codex\\archived_sessions\\" : "~/.codex/archived_sessions/"]);
    for (const [name, path] of paths) {
      const row = doc.createElement("p");
      row.append(doc.createTextNode(`${name}: `));
      copyButton(doc, row, path);
      parent.append(row);
    }
    const note = doc.createElement("p");
    note.className = "muted";
    note.textContent = "Click a path to copy it. These are default locations; custom installations may store logs elsewhere.";
    if (windows) note.textContent += " For agents running in WSL, choose Linux above and locate the logs inside that WSL distribution.";
    parent.append(note);
  }
  var activityRules = /* @__PURE__ */ new Set(["large_tool_output", "repeated_skill_load", "failed_tool_call"]);
  var reviewOnlyRules = /* @__PURE__ */ new Set([...activityRules, "repeated_tool_call", "repeated_failed_attempt", "recurring_user_request", "synthetic-example"]);
  var workspaces = /* @__PURE__ */ new WeakMap();
  function workspaceFor(doc) {
    let workspace = workspaces.get(doc);
    if (!workspace) {
      workspace = { reports: [], sources: /* @__PURE__ */ new Map(), active: null, nextId: 0, epoch: 0 };
      workspaces.set(doc, workspace);
    }
    return workspace;
  }
  function sourceSessionId(text2) {
    const ids = /* @__PURE__ */ new Set();
    for (const [index, line] of text2.split("\n").entries()) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        throw new Error(`Invalid session JSONL at line ${index + 1}.`);
      }
      if (!object2(row)) throw new Error(`Invalid session record at line ${index + 1}.`);
      if (row.type === "session_meta" && object2(row.payload)) {
        const id = row.payload.id ?? row.payload.session_id;
        if (string(id) && id) ids.add(`codex:${id}`);
      }
      if (string(row.sessionId) && row.sessionId) ids.add(`claude_code:${row.sessionId}`);
    }
    if (ids.size !== 1) throw new Error("Choose a Claude Code or Codex JSONL containing one session identity.");
    return [...ids][0];
  }
  var feedbackFiles = /* @__PURE__ */ new WeakMap();
  var reportGenerations = /* @__PURE__ */ new WeakMap();
  function renderReport(report, doc = root?.document) {
    const errors = validateReport2(report);
    if (errors.length) throw new Error(errors.slice(0, 8).join("\n"));
    if (!doc) return report;
    const generation = (reportGenerations.get(doc) ?? 0) + 1;
    reportGenerations.set(doc, generation);
    const byId = (id) => {
      const el = doc.getElementById(id);
      if (!el) throw new Error(`Missing viewer element: ${id}`);
      return el;
    };
    const node = (tag, text2, className) => {
      const el = doc.createElement(tag);
      if (text2 !== void 0) el.textContent = String(text2);
      if (className) el.className = className;
      return el;
    };
    const line = (parent, tag, text2, className) => {
      const el = node(tag, text2, className);
      parent.append(el);
      return el;
    };
    const clear = (id, text2) => {
      const el = byId(id);
      el.replaceChildren();
      if (text2) el.textContent = text2;
      return el;
    };
    const placeholder = (el, text2) => {
      if (!el.children.length) line(el, "p", text2, "empty");
    };
    byId("report-view").hidden = false;
    byId("empty-state").hidden = true;
    byId("import-error").hidden = true;
    byId("report-label").textContent = `Report ${report.report.id} \xB7 ${report.report.generated_at} \xB7 ${report.report.status}`;
    byId("demo-label").hidden = !report.report.demo;
    byId("demo-label").textContent = report === demoReport ? "REAL SESSION \xB7 SANITIZED EXCERPT" : "DEMO REPORT";
    byId("privacy-banner").textContent = `Opened files stay in your browser; nothing is uploaded. Report contents: Raw transcripts ${report.privacy.raw_transcripts_included ? "included" : "not included"}; excerpts ${report.privacy.excerpts_included ? "included" : "not included"}; redaction ${report.privacy.redaction_applied ? "applied" : "not applied"}. This report is not safe to share automatically; inspect it before sharing.`;
    const limitationCounts = /* @__PURE__ */ new Map();
    report.coverage.limitations.forEach((item) => limitationCounts.set(item, (limitationCounts.get(item) ?? 0) + 1));
    byId("coverage-banner").textContent = `Coverage: ${report.coverage.usage} usage \xB7 ${report.report.status} report \xB7 ${limitationCounts.size} limitation type(s) (${report.coverage.limitations.length} occurrences)`;
    const coverage2 = clear("coverage-details");
    for (const [item, count3] of limitationCounts) line(coverage2, "li", count3 === 1 ? item : `${item} \xB7 ${count3} occurrences`);
    if (!report.coverage.limitations.length) line(coverage2, "li", "No limitations reported. This does not verify outcomes.");
    const summary = clear("summary");
    for (const [title, value] of [["Sessions", report.summary.session_count], ["Tool calls", report.summary.tool_call_count], ["Observations", report.summary.finding_count], ["Input tokens", report.summary.input_tokens], ["Output tokens", report.summary.output_tokens], ["Total tokens", report.summary.total_tokens]]) {
      const card = line(summary, "div", void 0, "summary-card");
      line(card, "span", title, "eyebrow");
      line(card, "strong", formatNumber(value));
    }
    const workspace = workspaceFor(doc);
    const feedbackKey = reportFingerprint(report);
    let feedbackMap = feedbackFiles.get(doc);
    if (!feedbackMap) {
      feedbackMap = /* @__PURE__ */ new Map();
      feedbackFiles.set(doc, feedbackMap);
    }
    const feedbackForReport = () => feedbackMap.get(feedbackKey) ?? createFeedback(report);
    const sourcePanel = byId("source-inspector");
    const sourceFile = byId("source-file");
    const sourceUpload = byId("source-upload");
    const hasSource = (session) => workspace.sources.has(session.id) || report === demoReport;
    function sourceHelp(parent, session) {
      if (!["claude_code", "codex"].includes(session.agent)) return;
      const help = line(parent, "div", void 0, "source-help");
      line(help, "h4", "Find this session");
      const id = session.id.slice(session.id.indexOf(":") + 1), claude = session.agent === "claude_code";
      const value = claude ? id + ".jsonl" : id;
      line(help, "p", claude ? "Expected filename:" : "Session ID (look for a rollout filename containing this ID):");
      line(help, "code", value);
      copyButton(doc, help, value, claude ? "Copy filename" : "Copy session ID");
      pathGuide(doc, help, session.agent);
      line(help, "p", claude ? "Open your project folder and select the expected filename, or use Choose session folder to match logs automatically." : "Choose a date folder to match logs automatically.");
      line(help, "p", "Matching uses the identity inside the file.", "muted");
    }
    let sourceSelection = null;
    let sourceRead = 0;
    sourcePanel.hidden = true;
    sourceUpload.hidden = false;
    sourceFile.value = "";
    clear("source-view");
    clear("source-status");
    const inspectFile = async (file) => {
      if (!file || !sourceSelection) return;
      const selection = sourceSelection, read = ++sourceRead;
      const active = () => !sourcePanel.hidden && sourceSelection === selection && read === sourceRead && reportGenerations.get(doc) === generation;
      clear("source-view");
      try {
        if (file.size > MAX_FILE_BYTES) throw new Error("Source log exceeds the 20 MiB import limit.");
        const text2 = typeof file.text === "string" ? file.text : await file.text();
        if (!active()) return;
        const inspect = selection.sessionId.startsWith("codex:") ? inspectCodexLog : inspectClaudeLog;
        const entries = inspect(text2, selection.sessionId, selection.targets, file.size);
        sourceUpload.hidden = true;
        byId("source-help").hidden = true;
        byId("source-status").textContent = `Showing ${file.name || "selected file"} locally \xB7 ${selection.sessionId}. Nothing was uploaded.`;
        if (typeof file.text !== "string") {
          workspace.sources.set(selection.sessionId, { name: file.name || "Session log", text: text2, size: file.size, sessionId: selection.sessionId });
          workspace.refresh?.();
          sourceFile.value = "";
        }
        const view = byId("source-view");
        for (const entry of entries) {
          line(view, "h4", entry.title);
          line(view, "pre", entry.content, "source-content");
          if (entry.truncated) line(view, "p", "Preview truncated (tool entries: 100,000 characters; surrounding context: 4,000). Inspect the original JSONL for the remainder.", "muted");
        }
      } catch (cause) {
        if (!active()) return;
        sourceFile.value = "";
        sourceUpload.hidden = false;
        byId("source-help").hidden = false;
        byId("source-status").textContent = cause instanceof Error ? cause.message : "Unable to read selected source log.";
      }
    };
    sourceFile.onchange = (event) => {
      const files = Array.from(event.target.files ?? []);
      if (workspace.refresh) {
        void workspaceImports.get(doc)?.(files).then(() => {
          sourceFile.value = "";
          return inspectFile(sourceSelection ? workspace.sources.get(sourceSelection.sessionId) : void 0);
        });
      } else void inspectFile(files[0]);
    };
    byId("source-close").onclick = () => {
      sourcePanel.hidden = true;
      sourceSelection = null;
      sourceFile.value = "";
      clear("source-view");
    };
    let selected = null;
    function paintInspector(session) {
      const box = clear("inspector");
      if (!session) {
        line(box, "p", "Select a session to inspect its timeline.", "empty");
        return;
      }
      line(box, "h3", session.id);
      if (["claude_code", "codex"].includes(session.agent)) {
        line(box, "p", hasSource(session) ? "Log attached" : "Log missing", "source-availability");
        if (!hasSource(session)) sourceHelp(box, session);
      } else line(box, "p", "Source inspection unavailable for this agent.", "muted");
      line(box, "p", `${session.agent} \xB7 ${session.agent_version || "Version unavailable"}`, "muted");
      line(box, "p", `${session.started_at || "Start unavailable"} \u2192 ${session.ended_at || "End unavailable"}`);
      line(box, "p", `Parent: ${session.parent_id || "None reported"} \xB7 Relationship: ${session.relationship || "Unavailable"}`);
      line(box, "p", `Usage: ${session.coverage.usage}; tools: ${session.coverage.tools}; input ${formatNumber(session.usage.input_tokens)}, output ${formatNumber(session.usage.output_tokens)}, total ${formatNumber(session.usage.total_tokens)}`);
      line(box, "p", `Cache read ${formatNumber(session.usage.cache_read_tokens)} \xB7 cache write ${formatNumber(session.usage.cache_write_tokens)} \xB7 reasoning ${formatNumber(session.usage.reasoning_tokens)}`);
      line(box, "p", `Calls ${session.metrics.tool_call_count} \xB7 observed errors ${session.metrics.tool_error_count} (${session.coverage.observations?.errors ?? "coverage unknown"}) \xB7 confirmed skill loads ${session.metrics.skill_load_count} (${session.coverage.observations?.skill_loads ?? "coverage unknown"}) \xB7 events ${session.metrics.event_count}`);
      session.coverage.limitations.forEach((item) => line(box, "p", `Limitation: ${item}`, "muted"));
      line(box, "h4", "Models observed");
      const models = new Set(session.model_runs.filter((run) => run.model).map((run) => `${run.provider || "Provider unavailable"} / ${run.model}`));
      models.forEach((model) => line(box, "p", model));
      if (!models.size) line(box, "p", "Model not reported.", "muted");
      for (const episode of report.episodes ?? []) if (episode.session_id === session.id) {
        line(box, "h4", "Task episode " + episode.id);
        line(box, "p", `Outcome: ${episode.outcome.state} (${episode.outcome.basis}); criteria: ${episode.outcome.criteria ?? "unassessed"}`);
        line(box, "p", `Actions: ${episode.action_evidence_ids.length} \xB7 possible corrections: ${episode.correction_evidence_ids.length} \xB7 verification references: ${episode.verification_evidence_ids.length}`);
        episode.limitations.forEach((note) => line(box, "p", note, "muted"));
        line(box, "p", "Evidence: " + episode.evidence_ids.join(", "));
      }
      line(box, "h4", "Timeline");
      const timeline = line(box, "ol", void 0, "timeline");
      session.timeline.forEach((event) => line(timeline, "li", `${event.timestamp || "Time unavailable"} \xB7 ${event.type}${event.tool_name ? " \xB7 " + event.tool_name : ""} \xB7 ${event.event_id} \xB7 ${event.source_ref}`));
      placeholder(timeline, "No timeline events reported.");
    }
    function feedbackForm(parent, rec) {
      const panel = line(parent, "details", void 0, "feedback-panel");
      line(panel, "summary", "Record local feedback");
      const status = line(panel, "p", void 0, "muted feedback-status");
      status.setAttribute("role", "status");
      const show = () => {
        const entries = feedbackMap.get(feedbackKey)?.entries.filter((e) => e.recommendation_id === rec.id) ?? [];
        status.textContent = entries.length ? entries.map((e) => `${e.reviewer}: ${e.review.decision}; usefulness ${e.review.usefulness ?? "unknown"}; ${e.attempt.state}; follow-up ${e.follow_up?.outcome ?? "missing"} \u2014 ${e.review.reason}`).join("\n") : "Unreviewed. Acceptance, implementation and improvement are separate.";
      };
      show();
      const group = (parent2, title) => {
        const fields3 = line(parent2, "fieldset", void 0, "feedback-grid");
        line(fields3, "legend", title);
        return fields3;
      };
      let fields2 = group(panel, "Review");
      const input = (title, value = "", wide = false) => {
        const label = line(fields2, "label", void 0, "feedback-field" + (wide ? " feedback-wide" : ""));
        line(label, "span", title);
        const field = line(label, "textarea");
        field.rows = wide ? 3 : 1;
        field.value = value;
        return field;
      };
      const select = (title, options) => {
        const label = line(fields2, "label", void 0, "feedback-field");
        line(label, "span", title);
        const field = line(label, "select");
        options.forEach((value) => {
          const option = line(field, "option", value.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase()));
          option.value = value;
        });
        field.value = options[0];
        return field;
      };
      const reviewer = input("Reviewer (anonymous allowed)", "anonymous"), decision = select("Decision", ["defer", "accept", "reject"]), sufficient = select("Evidence sufficient", ["unknown", "yes", "no"]), correct = select("Factually correct", ["unknown", "yes", "no"]), rating = select("Usefulness", ["unknown", "1", "2", "3", "4", "5"]), reason = input("Reason", "", true);
      fields2 = group(panel, "Implementation");
      const attempted = select("Intervention attempt", ["not_attempted", "attempted", "unknown"]), change = input("What changed", "", true), test = input("Correctness test", "", true);
      const followup = line(panel, "details", void 0, "feedback-followup");
      line(followup, "summary", "Follow-up \xB7 optional");
      line(followup, "p", "Fill this in after trying the suggestion.", "muted");
      fields2 = group(followup, "Outcome");
      const outcome = select("Follow-up outcome", ["missing", "unknown", "improved", "unchanged", "worse"]), basis = select("Follow-up evidence basis", ["user_report", "observed_test", "model_inference"]), correctness = select("Follow-up correctness", ["unknown", "preserved", "regression"]), regressions = input("Regressions", "", true), effort = input("Additional effort", "", true), refs3 = input("Follow-up evidence IDs (comma separated)", "", true);
      const actions = line(panel, "div", void 0, "feedback-actions");
      const save = line(actions, "button", "Save feedback in this workspace", "primary");
      save.setAttribute("type", "button");
      line(actions, "span", "Export your feedback file to keep it after closing this page.", "muted");
      save.onclick = () => {
        try {
          const file = feedbackForReport(), entry = feedbackDraft(report, rec.id);
          const prior = file.entries.filter((e) => e.recommendation_id === rec.id && e.reviewer === reviewer.value).at(-1);
          entry.supersedes = prior?.id ?? null;
          entry.reviewer = reviewer.value || "anonymous";
          entry.review = { decision: decision.value, evidence_sufficient: sufficient.value === "unknown" ? null : sufficient.value === "yes", correct: correct.value === "unknown" ? null : correct.value === "yes", usefulness: rating.value === "unknown" ? null : Number(rating.value), reason: reason.value };
          entry.attempt = { state: attempted.value, change: change.value, correctness_test: test.value };
          if (outcome.value !== "missing") entry.follow_up = { outcome: outcome.value, basis: basis.value, correctness: correctness.value, regressions: regressions.value, additional_effort: effort.value, evidence_ids: refs3.value.split(",").map((id) => id.trim()).filter(Boolean) };
          feedbackMap.set(feedbackKey, appendFeedback(report, file, entry));
          show();
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : "Unable to save feedback";
        }
      };
    }
    function paintScope() {
      const filtered = selectScope(report, byId("agent-filter").value);
      byId("session-count").textContent = `(${filtered.sessions.length})`;
      const body = clear("sessions-body");
      filtered.sessions.forEach((session) => {
        const tr = node("tr");
        body.append(tr);
        const first = line(tr, "td");
        const button = line(first, "button", `${session.id} \xB7 ${session.agent}`, "session-link");
        line(first, "small", ["claude_code", "codex"].includes(session.agent) ? hasSource(session) ? "Log attached" : "Log missing" : "Source inspection unavailable", "source-availability");
        button.setAttribute("type", "button");
        button.addEventListener("click", () => {
          selected = session.id;
          paintInspector(session);
        });
        line(tr, "td", session.coverage.usage);
        line(tr, "td", formatNumber(session.usage.total_tokens), "numeric");
        line(tr, "td", formatNumber(session.metrics.tool_call_count), "numeric");
        line(tr, "td", formatNumber(session.metrics.tool_error_count) + " observed (" + (session.coverage.observations?.errors ?? "coverage unknown") + ")", "numeric");
      });
      byId("no-sessions").hidden = filtered.sessions.length !== 0;
      paintInspector(filtered.sessions.find((session) => session.id === selected));
      const findingGroups = /* @__PURE__ */ new Map();
      filtered.findings.forEach((finding) => {
        const key = JSON.stringify([finding.rule_id, finding.category, finding.title, finding.severity, finding.claim_type, finding.confidence, finding.interpretation]);
        const group = findingGroups.get(key) ?? [];
        group.push(finding);
        findingGroups.set(key, group);
      });
      const reviewGroups = [...findingGroups.values()].filter((group) => !activityRules.has(group[0].rule_id));
      const activityGroups = [...findingGroups.values()].filter((group) => activityRules.has(group[0].rule_id));
      const groupCount = (groups) => {
        const total = groups.reduce((n, group) => n + group.length, 0);
        return `(${groups.length} ${groups.length === 1 ? "type" : "types"} \xB7 ${total} ${total === 1 ? "observation" : "observations"})`;
      };
      byId("finding-count").textContent = groupCount(reviewGroups);
      byId("activity-count").textContent = groupCount(activityGroups);
      const evidence = new Map(report.evidence.map((item) => [item.id, item]));
      const sessions = new Map(report.sessions.map((session) => [session.id, session]));
      const findings = clear("findings");
      const activity = clear("activity");
      function paintFinding(parent, finding) {
        line(parent, "p", finding.observation);
        const details = line(parent, "details");
        line(details, "summary", `Evidence (${finding.evidence_ids.length})`);
        finding.evidence_ids.forEach((id) => {
          const e = evidence.get(id);
          line(details, "p", e ? `${e.session_id} \xB7 ${e.event_id} \xB7 ${e.source_ref}: ${e.description}` : `Evidence ${id} unavailable`);
          if (e && e.excerpt !== null) line(details, "pre", e.excerpt, "excerpt");
          const session = e && sessions.get(e.session_id);
          const event = session?.timeline.find((item) => item.event_id === e?.event_id && item.source_ref === e?.source_ref);
          if (e && session && ["claude_code", "codex"].includes(session.agent) && /^line:[1-9]\d*$/.test(e.source_ref) && event && sourceTypes.has(event.type)) {
            const button = line(details, "button", "Inspect source", "source-link");
            button.setAttribute("type", "button");
            button.addEventListener("click", () => {
              const related = finding.evidence_ids.length <= 40 ? finding.evidence_ids.map((item) => evidence.get(item)).filter((item) => item?.session_id === e.session_id) : [e];
              const targets = related.flatMap((item) => {
                const hit = session.timeline.find((row) => row.event_id === item?.event_id && row.source_ref === item?.source_ref);
                return item && hit && sourceTypes.has(hit.type) ? [{ source_ref: item.source_ref, type: hit.type }] : [];
              });
              sourceSelection = { sessionId: e.session_id, targets };
              sourcePanel.hidden = false;
              sourceUpload.hidden = false;
              const help = clear("source-help");
              help.hidden = false;
              sourceHelp(help, session);
              clear("source-view");
              byId("source-status").textContent = `Choose the matching ${session.agent === "codex" ? "Codex rollout" : "Claude Code"} JSONL for ${e.session_id} to inspect ${targets.map((item) => item.source_ref).join(" and ")}. The report does not contain the raw log.`;
              sourcePanel.scrollIntoView?.({ block: "start" });
              void inspectFile(workspace.sources.get(e.session_id) ?? (report === demoReport ? new File([demo_source_default], "codex-pages-session.jsonl") : void 0));
            });
          }
        });
      }
      [...findingGroups.values()].sort((a, b) => b.length - a.length).forEach((group) => {
        const finding = group[0];
        const ordinary = activityRules.has(finding.rule_id);
        const card = line(ordinary ? activity : findings, "article", void 0, ordinary ? "card" : "card review-card");
        line(card, "h3", `${finding.title} \xB7 ${group.length} ${group.length === 1 ? "occurrence" : "occurrences"}`);
        line(card, "p", ordinary ? "Activity only \u2014 not an improvement recommendation." : "Review candidate \u2014 usefulness requires context.", "muted");
        line(card, "p", finding.interpretation);
        const reviewActions = report.recommendations.filter((rec) => rec.kind === "investigate" && rec.finding_ids.some((id) => group.some((item) => item.id === id)));
        if (!ordinary) [...new Set(reviewActions.map((rec) => rec.action))].forEach((action) => line(card, "p", `Review question: ${action}`));
        if (group.length === 1) paintFinding(card, finding);
        else {
          const details = line(card, "details");
          line(details, "summary", `Inspect ${group.length} observations and evidence`);
          group.forEach((item) => {
            const occurrence = line(details, "div", void 0, "occurrence");
            line(occurrence, "p", item.session_ids.join(", "), "muted");
            paintFinding(occurrence, item);
          });
        }
      });
      placeholder(findings, "No review candidates identified for this scope.");
      placeholder(activity, "No size or standalone error observations for this scope. The session timeline contains all observed events.");
      const recommendationIds = new Set(filtered.findings.map((f) => f.id));
      const recs = clear("recommendations");
      const recommendationGroups = /* @__PURE__ */ new Map();
      report.recommendations.filter((rec) => rec.kind !== "investigate" && rec.finding_ids.some((id) => {
        const finding = filtered.findings.find((item) => item.id === id);
        return finding && !reviewOnlyRules.has(finding.rule_id) && finding.evidence_ids.length > 0;
      }) && (byId("agent-filter").value === "all" || rec.finding_ids.some((id) => recommendationIds.has(id)))).forEach((rec) => {
        const key = rec.overlap_group === null ? rec.id : JSON.stringify([rec.overlap_group, rec.title, rec.action, rec.kind, rec.priority]);
        const group = recommendationGroups.get(key) ?? [];
        group.push(rec);
        recommendationGroups.set(key, group);
      });
      [...recommendationGroups.values()].sort((a, b) => b.length - a.length).forEach((group) => {
        const rec = group[0];
        const card = line(recs, "article", void 0, "card suggestion-card");
        line(card, "h3", rec.title);
        line(card, "p", `${rec.kind} \xB7 ${rec.priority} priority \xB7 ${group.length} ${group.length === 1 ? "occurrence" : "occurrences"}`, "muted");
        line(card, "p", rec.action, "suggestion-action");
        const linked = filtered.findings.filter((item) => group.some((rec2) => rec2.finding_ids.includes(item.id)));
        const support = line(card, "details");
        line(support, "summary", "Why this is suggested \xB7 evidence");
        linked.forEach((finding) => paintFinding(support, finding));
        group.forEach((item) => feedbackForm(card, item));
        if (group.length > 1) {
          const details = line(card, "details");
          line(details, "summary", `Linked findings (${group.length})`);
          group.forEach((item) => line(details, "p", `${item.id} \xB7 ${item.finding_ids.join(", ")}`));
        }
      });
      byId("suggestion-count").textContent = `(${recommendationGroups.size})`;
      placeholder(recs, "No actionable improvements identified. Activity and review candidates below are not proof of wasted work.");
      const candidates = clear("candidates");
      filtered.candidates.forEach((candidate) => {
        const card = line(candidates, "article", void 0, "card");
        line(card, "h3", candidate.title);
        line(card, "p", `Proposed: ${candidate.recommendation} \xB7 ${candidate.trigger}`, "muted");
        line(card, "p", candidate.rationale);
        line(card, "p", `Evidence: ${candidate.evidence_ids.join(", ") || "None reported"}`);
        const tests = line(card, "ul");
        candidate.acceptance_tests.forEach((item) => line(tests, "li", item));
      });
      placeholder(candidates, "No skill candidates for this agent.");
    }
    function table(id, columns, data, values) {
      const holder = clear(id);
      if (!data.length) {
        placeholder(holder, "No observations reported.");
        return;
      }
      const t = line(holder, "table"), thead = line(t, "thead"), head = line(thead, "tr");
      columns.forEach((col) => line(head, "th", col));
      const tbody = line(t, "tbody");
      data.forEach((row) => {
        const tr = line(tbody, "tr");
        values(row).forEach((val) => line(tr, "td", val));
      });
    }
    table("tools", ["Tool", "Calls", "Observed errors (may be partial)", "Output characters"], report.metrics.tools, (t) => [t.name, formatNumber(t.calls), formatNumber(t.errors), formatNumber(t.output_chars)]);
    table("skills", ["Skill", "Confirmed loads (may be partial)", "States"], report.metrics.skills, (s) => [s.name, formatNumber(s.loads), s.states.join(", ") || "Unknown"]);
    const notes = clear("analysis-notes");
    line(notes, "p", `Analysis: ${report.analysis_usage.mode} \xB7 model tokens: ${formatNumber(report.analysis_usage.model_tokens)}`);
    report.analysis_usage.notes.forEach((note) => line(notes, "p", note));
    const feedbackPanel = line(notes, "details");
    line(feedbackPanel, "summary", "Local feedback files");
    line(feedbackPanel, "p", "Feedback stays in memory until you explicitly export it. Import requires the same report and recommendation fingerprints.");
    const feedbackStatus = line(feedbackPanel, "p");
    const exportFeedback = line(feedbackPanel, "button", "Export feedback JSON");
    exportFeedback.setAttribute("type", "button");
    exportFeedback.onclick = () => {
      try {
        const file = feedbackForReport();
        validateFeedback(report, file);
        const link = line(feedbackPanel, "a", "Download feedback.json");
        link.href = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(file, null, 2));
        link.download = "feedback.json";
        feedbackStatus.textContent = "Use the download link to save feedback locally.";
      } catch (error) {
        feedbackStatus.textContent = error instanceof Error ? error.message : "Unable to export feedback";
      }
    };
    const importLabel = line(feedbackPanel, "label", "Import feedback JSON");
    const importFeedback = line(importLabel, "input");
    importFeedback.type = "file";
    importFeedback.accept = ".json,application/json";
    importFeedback.onchange = async () => {
      try {
        const file = importFeedback.files?.[0];
        if (!file) return;
        if (file.size > MAX_FILE_BYTES) throw new Error("Feedback exceeds 20 MiB");
        const value = JSON.parse(await file.text());
        if (reportGenerations.get(doc) !== generation) return;
        validateFeedback(report, value);
        const current = feedbackForReport(), ids = new Map(current.entries.map((e) => [e.id, e]));
        let merged = current;
        for (const entry of value.entries) {
          const existing = ids.get(entry.id);
          if (existing) {
            if (JSON.stringify(existing) !== JSON.stringify(entry)) throw new Error("Conflicting feedback ID");
            continue;
          }
          merged = appendFeedback(report, merged, entry);
          ids.set(entry.id, entry);
        }
        feedbackMap.set(feedbackKey, merged);
        paintScope();
        feedbackStatus.textContent = `Imported ${value.entries.length} feedback records.`;
      } catch (error) {
        feedbackStatus.textContent = error instanceof Error ? error.message : "Unable to import feedback";
      }
    };
    byId("agent-filter").onchange = paintScope;
    workspace.sourcesChanged = () => {
      if (reportGenerations.get(doc) !== generation) return;
      paintScope();
      if (sourceSelection) {
        const session = report.sessions.find((item) => item.id === sourceSelection?.sessionId);
        const help = clear("source-help");
        if (session) sourceHelp(help, session);
      }
      if (sourceSelection && !sourcePanel.hidden) void inspectFile(workspace.sources.get(sourceSelection.sessionId));
    };
    paintScope();
    return report;
  }
  var workspaceImports = /* @__PURE__ */ new WeakMap();
  function bootstrap(doc = root?.document) {
    if (!doc) return;
    for (const [id, mime, content] of [["demo-report-download", "application/json", JSON.stringify(codex_pages_report_default, null, 2) + "\n"], ["demo-session-download", "application/x-ndjson", demo_source_default]]) {
      doc.getElementById(id)?.setAttribute("href", `data:${mime};charset=utf-8,${encodeURIComponent(content)}`);
    }
    const get = (id) => {
      const el = doc.getElementById(id);
      if (!el) throw new Error(`Missing viewer element: ${id}`);
      return el;
    };
    const error = (message) => {
      get("import-error").textContent = message;
      get("import-error").hidden = false;
    };
    const workspace = workspaceFor(doc);
    const selector = get("platform-select");
    selector.value = currentPlatform(doc);
    const updateGuide = () => {
      const guide = get("session-path-guide");
      guide.replaceChildren();
      pathGuide(doc, guide);
    };
    selector.onchange = () => {
      if (["mac", "windows", "linux", "unknown"].includes(selector.value)) platformChoices.set(doc, selector.value);
      updateGuide();
      workspace.sourcesChanged?.();
    };
    updateGuide();
    const hideReport = () => {
      reportGenerations.set(doc, (reportGenerations.get(doc) ?? 0) + 1);
      get("report-view").hidden = true;
      get("empty-state").hidden = false;
      get("source-view").replaceChildren();
      get("source-inspector").hidden = true;
      get("source-file").value = "";
      workspace.sourcesChanged = void 0;
    };
    const activate = (id) => {
      const entry = workspace.reports.find((item) => item.id === id);
      if (!entry) return;
      workspace.active = id;
      get("agent-filter").value = "all";
      renderReport(entry.report, doc);
      refresh();
    };
    const removeReport = (id) => {
      workspace.reports = workspace.reports.filter((item) => item.id !== id);
      if (workspace.active === id) {
        workspace.active = null;
        if (workspace.reports.length) activate(workspace.reports[0].id);
        else hideReport();
      }
      refresh();
    };
    const refresh = () => {
      get("workspace-files").hidden = workspace.reports.length + workspace.sources.size === 0;
      get("workspace-count").textContent = `(${workspace.reports.length} reports \xB7 ${workspace.sources.size} session logs)`;
      const list2 = get("workspace-list");
      list2.replaceChildren();
      const row = (name, description, remove, open, active = false) => {
        const item = doc.createElement("div");
        item.className = "workspace-file";
        const title = doc.createElement(open ? "button" : "span");
        title.textContent = name;
        title.className = "workspace-file-name";
        if (open) {
          title.setAttribute("type", "button");
          title.setAttribute("aria-pressed", String(active));
          title.onclick = open;
        }
        const detail = doc.createElement("span");
        detail.className = "muted";
        detail.textContent = description;
        const button = doc.createElement("button");
        button.textContent = "Remove";
        button.setAttribute("type", "button");
        button.setAttribute("aria-label", `Remove ${name}`);
        button.onclick = remove;
        item.append(title, detail, button);
        list2.append(item);
      };
      workspace.reports.forEach((entry) => row(entry.name, `${entry.report.sessions.length} sessions${entry.id === workspace.active ? " \xB7 Active report" : ""}`, () => removeReport(entry.id), () => activate(entry.id), entry.id === workspace.active));
      workspace.sources.forEach((source) => row(source.name, source.sessionId, () => {
        workspace.sources.delete(source.sessionId);
        get("source-close").click?.();
        get("source-view").replaceChildren();
        get("source-inspector").hidden = true;
        refresh();
        workspace.sourcesChanged?.();
      }));
    };
    workspace.refresh = refresh;
    const addReport = (report, name) => {
      const existing = workspace.reports.find((entry) => entry.name === name && JSON.stringify(entry.report) === JSON.stringify(report));
      if (existing) return existing.id;
      const id = ++workspace.nextId;
      workspace.reports.push({ id, name, report });
      return id;
    };
    let importQueue = Promise.resolve();
    const readFiles = (files, folder = false) => {
      const epoch = workspace.epoch;
      importQueue = importQueue.then(async () => {
        const errors = [];
        let firstReport;
        const wanted = new Set(workspace.reports.flatMap((entry) => entry.report.sessions.map((session) => session.id)));
        if (folder && !wanted.size) {
          error("Open a report before choosing a session folder.");
          return;
        }
        let matched = 0, ignored = 0, unreadable = 0;
        const attached = /* @__PURE__ */ new Set();
        get("import-status").textContent = folder ? "Matching session logs\u2026" : "";
        for (const file of files) {
          if (workspace.epoch !== epoch) return;
          if (folder && !/\.jsonl$/i.test(file.name ?? "")) {
            ignored++;
            continue;
          }
          try {
            if (file.size > MAX_FILE_BYTES) throw new Error("File exceeds the 20 MiB import limit.");
            const text2 = await file.text();
            if (workspace.epoch !== epoch) return;
            if (/\.jsonl$/i.test(file.name ?? "")) {
              if (new TextEncoder().encode(text2).length > MAX_FILE_BYTES) throw new Error("File exceeds the 20 MiB import limit.");
              const sessionId = sourceSessionId(text2);
              if (folder && (!wanted.has(sessionId) || attached.has(sessionId))) {
                ignored++;
                continue;
              }
              attached.add(sessionId);
              matched++;
              workspace.sources.set(sessionId, { name: file.name, text: text2, size: file.size, sessionId });
            } else {
              const id = addReport(parseReport(text2, file.size), file.name || "Report");
              firstReport ??= id;
            }
          } catch (cause) {
            if (folder) unreadable++;
            else errors.push(`${file.name || "File"}: ${cause instanceof Error ? cause.message : "Unable to read file."}`);
          }
        }
        if (firstReport !== void 0) activate(firstReport);
        refresh();
        workspace.sourcesChanged?.();
        get("import-error").hidden = !errors.length;
        if (folder) get("import-status").textContent = `Attached ${matched} matching log(s). ${ignored} unrelated / duplicate file(s) ignored; ${unreadable} invalid or oversized file(s) skipped.`;
        if (errors.length) error(errors.join("\n"));
      });
      return importQueue;
    };
    workspaceImports.set(doc, readFiles);
    const embedded = get("embedded-report");
    if (embedded.textContent.trim()) {
      try {
        activate(addReport(parseReport(embedded.textContent), "Embedded report"));
      } catch (cause) {
        error(cause instanceof Error ? cause.message : "Unable to open report.");
      }
    }
    get("clear-button").addEventListener("click", () => {
      if (workspace.active !== null) removeReport(workspace.active);
    });
    get("workspace-clear").addEventListener("click", () => {
      feedbackFiles.delete(doc);
      workspace.epoch++;
      workspace.reports = [];
      workspace.sources.clear();
      workspace.active = null;
      hideReport();
      refresh();
      get("import-error").hidden = true;
      get("import-status").textContent = "";
      get("report-file").value = "";
    });
    get("report-file").addEventListener("change", (event) => {
      const input = event.target;
      void readFiles(Array.from(input.files ?? []));
      input.value = "";
    });
    get("session-folder").addEventListener("change", (event) => {
      const input = event.target;
      void readFiles(Array.from(input.files ?? []), true);
      input.value = "";
    });
    const zone = get("drop-zone");
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      zone.classList.add("dragover");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("dragover");
      void readFiles(Array.from(event.dataTransfer?.files ?? []));
    });
    get("demo-button").addEventListener("click", () => {
      activate(addReport(demoReport, "Real session demo"));
    });
    refresh();
  }
  var api = { validateReport: validateReport2, parseReport, inspectClaudeLog, inspectCodexLog, selectScope, formatNumber, renderReport, bootstrap, detectPlatform, MAX_FILE_BYTES };
  if (root) {
    root.SessionAnalysis = api;
    if (root.document) {
      if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", () => bootstrap(root.document));
      else bootstrap(root.document);
    }
  }
})();
