"use strict";
(() => {
  // src/web/app.ts
  var root = typeof window === "undefined" ? void 0 : window;
  var object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  var string = (v) => typeof v === "string";
  var count = (v) => Number.isSafeInteger(v) && v >= 0;
  var nullableString = (v) => v === null || string(v);
  var token = (v) => v === null || count(v);
  var list = (check) => (v) => Array.isArray(v) && v.every(check);
  var oneOf = (values) => (v) => values.includes(v);
  var usage = { input_tokens: token, output_tokens: token, cache_read_tokens: token, cache_write_tokens: token, reasoning_tokens: token, total_tokens: token };
  function validateReport(value) {
    const errors = [];
    function shape(v, fields, at) {
      if (!object(v)) {
        errors.push(at + " must be an object.");
        return;
      }
      for (const [key, check] of Object.entries(fields)) if (!check(v[key])) errors.push(at + "." + key + " is missing or invalid.");
    }
    function rows(v, fields, at) {
      if (Array.isArray(v)) v.forEach((item, i) => shape(item, fields, at + "[" + i + "]"));
    }
    const strings = list(string), array = Array.isArray;
    shape(value, { schema_version: (v) => v === "1.0.0", report: object, scope: object, coverage: object, summary: object, sessions: array, metrics: object, findings: array, recommendations: array, skill_candidates: array, evidence: array, analysis_usage: object, privacy: object }, "Report");
    if (!object(value)) return errors;
    shape(value.report, { id: string, generated_at: (v) => string(v) && Number.isFinite(Date.parse(v)), analyzer_version: string, mode: oneOf(["single_session", "multi_session"]), status: oneOf(["complete", "partial"]), demo: (v) => typeof v === "boolean" }, "report");
    shape(value.scope, { session_ids: strings, excluded_sessions: list(object) }, "scope");
    const coverage = { usage: oneOf(["reported", "partial", "unavailable"]), limitations: strings };
    shape(value.coverage, coverage, "coverage");
    shape(value.summary, { session_count: count, tool_call_count: count, finding_count: count, input_tokens: token, output_tokens: token, total_tokens: token }, "summary");
    shape(value.metrics, { tools: array, skills: array }, "metrics");
    if (object(value.metrics)) {
      rows(value.metrics.tools, { name: string, calls: count, errors: count, output_chars: count }, "metrics.tools");
      rows(value.metrics.skills, { name: string, loads: count, states: strings }, "metrics.skills");
    }
    rows(value.sessions, { id: string, agent: oneOf(["claude_code", "codex", "hermes"]), agent_version: nullableString, started_at: nullableString, ended_at: nullableString, parent_id: nullableString, relationship: nullableString, usage: object, coverage: object, metrics: object, model_runs: array, timeline: array }, "sessions");
    if (Array.isArray(value.sessions)) value.sessions.forEach((s, i) => {
      if (!object(s)) return;
      shape(s.usage, usage, "sessions[" + i + "].usage");
      shape(s.coverage, { ...coverage, tools: oneOf(["observed", "unavailable"]) }, "sessions[" + i + "].coverage");
      shape(s.metrics, { tool_call_count: count, tool_error_count: count, skill_load_count: count, event_count: count }, "sessions[" + i + "].metrics");
      rows(s.model_runs, { model: nullableString, provider: nullableString }, "model_runs");
      rows(s.timeline, { event_id: string, type: string, timestamp: nullableString, tool_name: nullableString, source_ref: string }, "timeline");
    });
    rows(value.findings, { id: string, category: string, rule_id: string, title: string, severity: oneOf(["low", "medium", "high"]), claim_type: oneOf(["observed", "inferred"]), confidence: oneOf(["low", "medium", "high"]), session_ids: strings, evidence_ids: strings, observation: string, interpretation: string, recommendation_ids: strings }, "findings");
    rows(value.recommendations, { id: string, title: string, action: string, kind: oneOf(["skill", "script", "template", "instruction", "workflow", "investigate"]), priority: oneOf(["low", "medium", "high"]), finding_ids: strings, overlap_group: nullableString }, "recommendations");
    rows(value.skill_candidates, { id: string, title: string, trigger: string, session_ids: strings, evidence_ids: strings, recommendation: oneOf(["create", "extend", "merge", "defer"]), rationale: string, acceptance_tests: strings }, "skill_candidates");
    rows(value.evidence, { id: string, session_id: string, event_id: string, source_ref: string, description: string, excerpt: nullableString }, "evidence");
    shape(value.analysis_usage, { mode: oneOf(["metrics_only", "assisted"]), model_tokens: token, notes: strings }, "analysis_usage");
    shape(value.privacy, { raw_transcripts_included: (v) => v === false, excerpts_included: (v) => typeof v === "boolean", redaction_applied: (v) => typeof v === "boolean", safe_to_share: (v) => v === null }, "privacy");
    return errors;
  }
  var MAX_FILE_BYTES = 20 * 1024 * 1024;
  var sourceTypes = /* @__PURE__ */ new Set(["tool_call", "tool_result", "user", "assistant"]);
  function describeToolInput(name, input) {
    if (!object(input)) return "";
    if (name === "Read" && string(input.file_path)) {
      const offset = count(input.offset) && input.offset > 0 ? input.offset : 1;
      return count(input.limit) && input.limit > 0 ? `Read up to ${input.limit} lines starting at line ${offset}: ${input.file_path}` : input.offset === void 0 ? `Read file (tool may limit output): ${input.file_path}` : `Read from line ${offset}: ${input.file_path}`;
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
  function inspectClaudeLog(text, sessionId, targets, size) {
    if (size !== void 0 && size > MAX_FILE_BYTES || new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error("Source log exceeds the 20 MiB import limit.");
    if (!sessionId.startsWith("claude_code:") || !targets.length) throw new Error("Select Claude Code tool evidence first.");
    const rows = text.split("\n");
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
      if (!object(record) || record.sessionId !== sessionId.slice("claude_code:".length)) throw new Error(`Source line ${line} belongs to a different session.`);
      if (target.type === "user" || target.type === "assistant") {
        if (record.isMeta === true) throw new Error("Injected metadata is not a user request.");
        const body = textOf(record);
        if (record.type !== target.type || !body) throw new Error(`Source line ${line} does not contain the expected ${target.type} text.`);
        return { line, title: `line ${line} \xB7 ${target.type === "user" ? "user request" : "assistant context"}`, content: body.slice(0, 4e3), truncated: body.length > 4e3 };
      }
      const role = target.type === "tool_call" ? "assistant" : "user";
      const blockType = target.type === "tool_call" ? "tool_use" : "tool_result";
      const blocks = object(record.message) && Array.isArray(record.message.content) ? record.message.content.filter((b) => object(b) && b.type === blockType) : [];
      if (record.type !== role || !blocks.length) throw new Error(`Source line ${line} does not contain the expected ${target.type}.`);
      const parts = blocks.map((block) => {
        if (target.type === "tool_call") {
          if (string(block.id)) seenCalls.add(block.id);
          const description = describeToolInput(block.name, block.input);
          const command = object(block.input) && string(block.input.command) ? `Command (not executed):
${block.input.command}

` : "";
          return `${description ? description + "\n\n" : ""}${string(block.name) ? block.name : "Unnamed tool"} \xB7 input
${command}${JSON.stringify(block.input ?? {}, null, 2)}`;
        }
        if (string(block.tool_use_id)) seenResults.add(block.tool_use_id);
        const value = block.content;
        const output = string(value) ? value : Array.isArray(value) ? value.map((part) => object(part) && part.type === "text" && string(part.text) ? part.text : "[Non-text content omitted]").join("\n") : JSON.stringify(value ?? "");
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
        return object(row) ? row : null;
      } catch {
        return null;
      }
    }
    function textOf(record) {
      if (!object(record.message)) return "";
      const content = record.message.content;
      return string(content) ? content : Array.isArray(content) ? content.filter((b) => object(b) && b.type === "text" && string(b.text)).map((b) => b.text).join("\n") : "";
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
      if (row.type !== "assistant" || !object(row.message)) continue;
      const blocks = Array.isArray(row.message.content) ? row.message.content : [];
      const tools = blocks.filter((b) => object(b) && b.type === "tool_use").map((b) => `${b.name || "Unnamed tool"} \xB7 input
${JSON.stringify(b.input ?? {}, null, 2)}`).join("\n");
      const body = [textOf(row), tools].filter(Boolean).join("\n");
      if (body) {
        next = bounded(line, `line ${line} \xB7 Next recorded action (not a verified outcome)`, body);
        break;
      }
    }
    return [...context, ...entries, ...next ? [next] : [bounded(last, "Context limitation", "Next action not found within 20 source lines, or a new user request/session boundary intervened.")]];
  }
  function parseReport(text, size) {
    if (size !== void 0 && size > MAX_FILE_BYTES || new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error("Report exceeds the 20 MiB import limit.");
    let value;
    try {
      value = JSON.parse(text);
    } catch (_) {
      throw new Error("Invalid JSON. Choose an exported Session Analysis report.");
    }
    const errors = validateReport(value);
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
  var activityRules = /* @__PURE__ */ new Set(["large_tool_output", "repeated_skill_load", "failed_tool_call"]);
  var reviewOnlyRules = /* @__PURE__ */ new Set([...activityRules, "repeated_tool_call", "repeated_failed_attempt", "recurring_user_request", "synthetic-example"]);
  var reportGenerations = /* @__PURE__ */ new WeakMap();
  function renderReport(report, doc = root?.document) {
    const errors = validateReport(report);
    if (errors.length) throw new Error(errors.slice(0, 8).join("\n"));
    if (!doc) return report;
    const generation = (reportGenerations.get(doc) ?? 0) + 1;
    reportGenerations.set(doc, generation);
    const byId = (id) => {
      const el = doc.getElementById(id);
      if (!el) throw new Error(`Missing viewer element: ${id}`);
      return el;
    };
    const node = (tag, text, className) => {
      const el = doc.createElement(tag);
      if (text !== void 0) el.textContent = String(text);
      if (className) el.className = className;
      return el;
    };
    const line = (parent, tag, text, className) => {
      const el = node(tag, text, className);
      parent.append(el);
      return el;
    };
    const clear = (id, text) => {
      const el = byId(id);
      el.replaceChildren();
      if (text) el.textContent = text;
      return el;
    };
    const placeholder = (el, text) => {
      if (!el.children.length) line(el, "p", text, "empty");
    };
    byId("report-view").hidden = false;
    byId("empty-state").hidden = true;
    byId("import-error").hidden = true;
    byId("report-label").textContent = `Report ${report.report.id} \xB7 ${report.report.generated_at} \xB7 ${report.report.status}`;
    byId("demo-label").hidden = !report.report.demo;
    byId("privacy-banner").textContent = `Privacy: Raw transcripts ${report.privacy.raw_transcripts_included ? "included" : "not included"}; excerpts ${report.privacy.excerpts_included ? "included" : "not included"}; redaction ${report.privacy.redaction_applied ? "applied" : "not applied"}. This report is not safe to share automatically; inspect it before sharing.`;
    const limitationCounts = /* @__PURE__ */ new Map();
    report.coverage.limitations.forEach((item) => limitationCounts.set(item, (limitationCounts.get(item) ?? 0) + 1));
    byId("coverage-banner").textContent = `Coverage: ${report.coverage.usage} usage \xB7 ${report.report.status} report \xB7 ${limitationCounts.size} limitation type(s) (${report.coverage.limitations.length} occurrences)`;
    const coverage = clear("coverage-details");
    for (const [item, count2] of limitationCounts) line(coverage, "li", count2 === 1 ? item : `${item} \xB7 ${count2} occurrences`);
    if (!report.coverage.limitations.length) line(coverage, "li", "No limitations reported. This does not verify outcomes.");
    const summary = clear("summary");
    for (const [title, value] of [["Sessions", report.summary.session_count], ["Tool calls", report.summary.tool_call_count], ["Observations", report.summary.finding_count], ["Input tokens", report.summary.input_tokens], ["Output tokens", report.summary.output_tokens], ["Total tokens", report.summary.total_tokens]]) {
      const card = line(summary, "div", void 0, "summary-card");
      line(card, "span", title, "eyebrow");
      line(card, "strong", formatNumber(value));
    }
    const sourcePanel = byId("source-inspector");
    const sourceFile = byId("source-file");
    let sourceSelection = null;
    let sourceRead = 0;
    sourcePanel.hidden = true;
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
        const text = await file.text();
        if (!active()) return;
        const entries = inspectClaudeLog(text, selection.sessionId, selection.targets, file.size);
        byId("source-status").textContent = `Showing ${file.name || "selected file"} locally \xB7 ${selection.sessionId}. Nothing was uploaded.`;
        const view = byId("source-view");
        for (const entry of entries) {
          line(view, "h4", entry.title);
          line(view, "pre", entry.content, "source-content");
          if (entry.truncated) line(view, "p", "Preview truncated (tool entries: 100,000 characters; surrounding context: 4,000). Inspect the original JSONL for the remainder.", "muted");
        }
      } catch (cause) {
        if (!active()) return;
        sourceFile.value = "";
        byId("source-status").textContent = cause instanceof Error ? cause.message : "Unable to read selected source log.";
      }
    };
    sourceFile.onchange = (event) => {
      void inspectFile(event.target.files?.[0]);
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
      line(box, "p", `${session.agent} \xB7 ${session.agent_version || "Version unavailable"}`, "muted");
      line(box, "p", `${session.started_at || "Start unavailable"} \u2192 ${session.ended_at || "End unavailable"}`);
      line(box, "p", `Parent: ${session.parent_id || "None reported"} \xB7 Relationship: ${session.relationship || "Unavailable"}`);
      line(box, "p", `Usage: ${session.coverage.usage}; tools: ${session.coverage.tools}; input ${formatNumber(session.usage.input_tokens)}, output ${formatNumber(session.usage.output_tokens)}, total ${formatNumber(session.usage.total_tokens)}`);
      line(box, "p", `Cache read ${formatNumber(session.usage.cache_read_tokens)} \xB7 cache write ${formatNumber(session.usage.cache_write_tokens)} \xB7 reasoning ${formatNumber(session.usage.reasoning_tokens)}`);
      line(box, "p", `Calls ${session.metrics.tool_call_count} \xB7 errors ${session.metrics.tool_error_count} \xB7 skill loads ${session.metrics.skill_load_count} \xB7 events ${session.metrics.event_count}`);
      session.coverage.limitations.forEach((item) => line(box, "p", `Limitation: ${item}`, "muted"));
      line(box, "h4", "Models observed");
      const models = new Set(session.model_runs.filter((run) => run.model).map((run) => `${run.provider || "Provider unavailable"} / ${run.model}`));
      models.forEach((model) => line(box, "p", model));
      if (!models.size) line(box, "p", "Model not reported.", "muted");
      line(box, "h4", "Timeline");
      const timeline = line(box, "ol", void 0, "timeline");
      session.timeline.forEach((event) => line(timeline, "li", `${event.timestamp || "Time unavailable"} \xB7 ${event.type}${event.tool_name ? " \xB7 " + event.tool_name : ""} \xB7 ${event.event_id} \xB7 ${event.source_ref}`));
      placeholder(timeline, "No timeline events reported.");
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
        button.setAttribute("type", "button");
        button.addEventListener("click", () => {
          selected = session.id;
          paintInspector(session);
        });
        line(tr, "td", session.coverage.usage);
        line(tr, "td", formatNumber(session.usage.total_tokens), "numeric");
        line(tr, "td", formatNumber(session.metrics.tool_call_count), "numeric");
        line(tr, "td", formatNumber(session.metrics.tool_error_count), "numeric");
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
          if (e && session?.agent === "claude_code" && /^line:[1-9]\d*$/.test(e.source_ref) && event && sourceTypes.has(event.type)) {
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
              clear("source-view");
              byId("source-status").textContent = `Choose the Claude Code JSONL for ${e.session_id} to inspect ${targets.map((item) => item.source_ref).join(" and ")}. The report does not contain the raw log.`;
              sourcePanel.scrollIntoView?.({ block: "start" });
              void inspectFile(sourceFile.files?.[0]);
            });
          }
        });
      }
      [...findingGroups.values()].sort((a, b) => b.length - a.length).forEach((group) => {
        const finding = group[0];
        const ordinary = activityRules.has(finding.rule_id);
        const card = line(ordinary ? activity : findings, "article", void 0, "card");
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
        const card = line(recs, "article", void 0, "card");
        line(card, "h3", rec.title);
        line(card, "p", `${rec.kind} \xB7 ${rec.priority} priority \xB7 ${group.length} ${group.length === 1 ? "occurrence" : "occurrences"}`, "muted");
        line(card, "p", rec.action);
        const linked = filtered.findings.filter((item) => group.some((rec2) => rec2.finding_ids.includes(item.id)));
        const support = line(card, "details");
        line(support, "summary", "Why this is suggested \xB7 evidence");
        linked.forEach((finding) => paintFinding(support, finding));
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
    table("tools", ["Tool", "Calls", "Errors", "Output characters"], report.metrics.tools, (t) => [t.name, formatNumber(t.calls), formatNumber(t.errors), formatNumber(t.output_chars)]);
    table("skills", ["Skill", "Loads", "States"], report.metrics.skills, (s) => [s.name, formatNumber(s.loads), s.states.join(", ") || "Unknown"]);
    const notes = clear("analysis-notes");
    line(notes, "p", `Analysis: ${report.analysis_usage.mode} \xB7 model tokens: ${formatNumber(report.analysis_usage.model_tokens)}`);
    report.analysis_usage.notes.forEach((note) => line(notes, "p", note));
    byId("agent-filter").addEventListener("change", paintScope);
    paintScope();
    return report;
  }
  function syntheticDemo() {
    const id = "hermes:synthetic-example";
    return {
      schema_version: "1.0.0",
      report: { id: "synthetic-demo", generated_at: "2026-01-01T00:00:00Z", analyzer_version: "0.1.0", mode: "single_session", status: "partial", demo: true },
      scope: { session_ids: [id], excluded_sessions: [] },
      coverage: { usage: "partial", limitations: ["Synthetic illustrative data; not derived from real sessions.", "Outcome verification unavailable."] },
      summary: { session_count: 1, tool_call_count: 2, finding_count: 1, input_tokens: 120, output_tokens: null, total_tokens: null },
      sessions: [{
        id,
        agent: "hermes",
        agent_version: null,
        started_at: null,
        ended_at: null,
        parent_id: null,
        relationship: null,
        usage: { input_tokens: 120, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null, reasoning_tokens: null, total_tokens: null },
        coverage: { usage: "partial", tools: "observed", limitations: ["Synthetic usage is incomplete."] },
        metrics: { tool_call_count: 2, tool_error_count: 0, skill_load_count: 1, event_count: 2 },
        model_runs: [],
        timeline: [
          { event_id: "example-1", type: "tool_call", timestamp: null, tool_name: "example_tool", source_ref: "synthetic:1" },
          { event_id: "example-2", type: "skill", timestamp: null, tool_name: null, source_ref: "synthetic:2" }
        ]
      }],
      metrics: { tools: [{ name: "example_tool", calls: 2, errors: 0, output_chars: 48 }], skills: [{ name: "example-skill", loads: 1, states: ["loaded"] }] },
      findings: [{ id: "example-finding", category: "tool_efficiency", rule_id: "synthetic-example", title: "Repeated tool invocation (illustrative)", severity: "low", claim_type: "observed", confidence: "low", session_ids: [id], evidence_ids: ["example-evidence"], observation: "Two example calls were observed.", interpretation: "Repetition does not prove wasted work.", recommendation_ids: ["example-recommendation"] }],
      recommendations: [{ id: "example-recommendation", title: "Inspect repetition", action: "Review source context before changing the workflow.", kind: "investigate", priority: "low", finding_ids: ["example-finding"], overlap_group: null }],
      skill_candidates: [{ id: "example-candidate", title: "Example workflow candidate", trigger: "Recurring similar task", session_ids: [id], evidence_ids: ["example-evidence"], recommendation: "defer", rationale: "A synthetic example cannot establish a real recurring workflow.", acceptance_tests: ["Confirm with real evidence."] }],
      evidence: [{ id: "example-evidence", session_id: id, event_id: "example-1", source_ref: "synthetic:1", description: "Illustrative tool call.", excerpt: null }],
      analysis_usage: { mode: "metrics_only", model_tokens: null, notes: ["Synthetic example only."] },
      privacy: { raw_transcripts_included: false, excerpts_included: false, redaction_applied: false, safe_to_share: null }
    };
  }
  function bootstrap(doc = root?.document) {
    if (!doc) return;
    const get = (id) => {
      const el = doc.getElementById(id);
      if (!el) throw new Error(`Missing viewer element: ${id}`);
      return el;
    };
    const error = (message) => {
      get("import-error").textContent = message;
      get("import-error").hidden = false;
    };
    const load = (text) => {
      try {
        renderReport(parseReport(text), doc);
      } catch (cause) {
        error(cause instanceof Error ? cause.message : "Unable to open report.");
      }
    };
    const embedded = get("embedded-report");
    if (embedded && embedded.textContent.trim()) load(embedded.textContent);
    get("clear-button").addEventListener("click", () => {
      get("report-view").hidden = true;
      get("empty-state").hidden = false;
      get("import-error").hidden = true;
      get("import-error").textContent = "";
      get("agent-filter").value = "all";
      get("report-file").value = "";
      get("source-file").value = "";
      get("source-view").replaceChildren();
      get("source-inspector").hidden = true;
    });
    const readFile = async (file) => {
      if (!file) return;
      try {
        if (file.size > MAX_FILE_BYTES) throw new Error("Report exceeds the 20 MiB import limit.");
        const text = await file.text();
        renderReport(parseReport(text, file.size), doc);
        get("agent-filter").value = "all";
        get("agent-filter").dispatchEvent(new Event("change"));
      } catch (cause) {
        error(cause instanceof Error ? cause.message : "Unable to open report.");
      }
    };
    get("report-file").addEventListener("change", (event) => {
      void readFile(event.target.files?.[0]);
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
      void readFile(event.dataTransfer?.files?.[0]);
    });
    get("demo-button").addEventListener("click", () => {
      get("agent-filter").value = "all";
      renderReport(syntheticDemo(), doc);
    });
  }
  var api = { validateReport, parseReport, inspectClaudeLog, selectScope, formatNumber, renderReport, bootstrap, MAX_FILE_BYTES };
  if (root) {
    root.SessionAnalysis = api;
    if (root.document) {
      if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", () => bootstrap(root.document));
      else bootstrap(root.document);
    }
  }
})();
