export type AgentName = 'claude_code' | 'codex' | 'hermes';
export type UsageCoverage = 'reported' | 'partial' | 'unavailable';
export type EventType = 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'skill' | 'usage' | 'compression';

export interface Usage {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
}

export interface NormalizedEvent {
  id: string;
  type: EventType;
  timestamp: string | null;
  text: string;
  source_ref: string;
  tool_name?: string;
  call_id?: string;
  arguments?: unknown;
  comparison_arguments?: unknown;
  is_error?: boolean | null;
  skill_name?: string;
  skill_state?: 'invoked' | 'loaded' | 'applied' | 'unknown';
  model?: string | null;
  provider?: string | null;
  usage?: Usage;
}

export interface NormalizedSession {
  id: string;
  agent: AgentName;
  agent_version: string | null;
  source: {format: string; fingerprint: string};
  started_at: string | null;
  ended_at: string | null;
  parent_id: string | null;
  relationship: string | null;
  events: NormalizedEvent[];
  usage: Usage;
  coverage: {usage: UsageCoverage; tools: 'observed' | 'unavailable'; limitations: string[]; observations?: {errors: UsageCoverage; skill_loads: UsageCoverage; usage_granularity: 'request' | 'session' | 'unavailable'; source_context: boolean}};
}

export interface ReportSession {
  id: string;
  agent: AgentName;
  agent_version: string | null;
  started_at: string | null;
  ended_at: string | null;
  parent_id: string | null;
  relationship: string | null;
  usage: Usage;
  coverage: NormalizedSession['coverage'];
  source?: {format:string;fingerprint:string;normalized_sha256:string};
  metrics: {tool_call_count: number; tool_error_count: number; skill_load_count: number; event_count: number};
  model_runs: Array<{model: string | null; provider: string | null}>;
  timeline: Array<{event_id: string; type: EventType; timestamp: string | null; tool_name: string | null; source_ref: string}>;
}

export interface Finding {
  id: string;
  category: 'token_usage' | 'context_growth' | 'tool_efficiency' | 'skill_usage' | 'workflow_efficiency' | 'repeatable_tasks' | 'outcome_verification' | 'analysis_overhead';
  rule_id: string;
  title: string;
  severity: 'low' | 'medium' | 'high';
  claim_type: 'observed' | 'inferred';
  confidence: 'low' | 'medium' | 'high';
  session_ids: string[];
  evidence_ids: string[];
  observation: string;
  interpretation: string;
  recommendation_ids: string[];
}
export interface Recommendation {
  id: string;
  title: string;
  action: string;
  kind: 'skill' | 'script' | 'template' | 'instruction' | 'workflow' | 'investigate';
  priority: 'low' | 'medium' | 'high';
  finding_ids: string[];
  overlap_group: string | null;
}
export interface SkillCandidate {
  id: string;
  title: string;
  trigger: string;
  session_ids: string[];
  evidence_ids: string[];
  recommendation: 'create' | 'extend' | 'merge' | 'defer';
  rationale: string;
  acceptance_tests: string[];
}
export interface Evidence {
  id: string;
  session_id: string;
  event_id: string;
  source_ref: string;
  description: string;
  excerpt: string | null;
}

export interface Report {
  schema_version: '1.0.0';
  provenance?: {analyzer: {version:string;revision:string|null;build_sha256:string};instructions:{skill_sha256:string;guide_sha256:string};interpretations: InterpretationProvenance[]};
  report: {id: string; generated_at: string; analyzer_version: string; mode: 'single_session' | 'multi_session'; status: 'complete' | 'partial'; demo: boolean};
  scope: {session_ids: string[]; excluded_sessions: Array<{id: string; reason: string}>};
  coverage: {usage: UsageCoverage; limitations: string[]};
  summary: {session_count: number; tool_call_count: number; finding_count: number; input_tokens: number | null; output_tokens: number | null; total_tokens: number | null};
  sessions: ReportSession[];
  metrics: {tools: Array<{name: string; calls: number; errors: number; output_chars: number}>; skills: Array<{name: string; loads: number; states: string[]}>};
  findings: Finding[];
  recommendations: Recommendation[];
  skill_candidates: SkillCandidate[];
  evidence: Evidence[];
  analysis_usage: {mode: 'metrics_only' | 'assisted'; model_tokens: number | null; notes: string[]};
  privacy: {raw_transcripts_included: false; excerpts_included: boolean; redaction_applied: boolean; safe_to_share: null};
}

export interface InterpretationProvenance {
  model:string|null;
  instruction_sha256:string|null;
  packet_sha256:string|null;
  max_chars:number|null;
  context_event_ids:string[];
  model_tokens:number|null;
}
