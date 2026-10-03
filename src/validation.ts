import type {Report} from './types.js';

const usageFields=['input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','reasoning_tokens','total_tokens'];
const categories=['token_usage','context_growth','tool_efficiency','skill_usage','workflow_efficiency','repeatable_tasks','outcome_verification','analysis_overhead'];
const events=['user','assistant','tool_call','tool_result','skill','usage','compression'];
const coverage=['reported','partial','unavailable'];
function fail(path:string):never {throw new Error(`${path}: invalid report`);}
function obj(value:unknown,fields:string[],path:string):Record<string,unknown> {
  if(value===null||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==fields.length||fields.some(k=>!Object.hasOwn(value,k))) fail(path);
  return value as Record<string,unknown>;
}
function arr(value:unknown,path:string):unknown[] {if(!Array.isArray(value)) fail(path);return value;}
function str(v:unknown,path:string):void {if(typeof v!=='string') fail(path);}
function count(v:unknown,path:string):void {if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0) fail(path);}
function nullable(v:unknown,check:(x:unknown,p:string)=>void,path:string):void {if(v!==null) check(v,path);}
function en(v:unknown,values:readonly string[],path:string):void {if(typeof v!=='string'||!values.includes(v)) fail(path);}
function strings(v:unknown,path:string):string[] {const a=arr(v,path);a.forEach(x=>str(x,path));return a as string[];}
function unique(v:unknown,path:string):Set<string> {const ids=arr(v,path).map(x=>{str(objId(x,path),path+'.id');return objId(x,path) as string;});const result=new Set(ids);if(result.size!==ids.length) fail(path);return result;}
function objId(x:unknown,path:string):unknown {if(x===null||typeof x!=='object'||Array.isArray(x)||!Object.hasOwn(x,'id')) fail(path);return (x as {id:unknown}).id;}
function refs(v:unknown,known:Set<string>,path:string):string[] {const a=strings(v,path);if(a.some(id=>!known.has(id))) fail(path);return a;}
function usage(v:unknown,path:string):void {const x=obj(v,usageFields,path);for(const k of usageFields) nullable(x[k],count,path+'.'+k);}

/** Validate report 1.0.0 including references and privacy invariants; never echo untrusted data in errors. */
export function validateReport(value:unknown):asserts value is Report {
  const rootFields=['schema_version','report','scope','coverage','summary','sessions','metrics','findings','recommendations','skill_candidates','evidence','analysis_usage','privacy'];if(value&&typeof value==='object'&&Object.hasOwn(value,'provenance')) rootFields.push('provenance');
  const r=obj(value,rootFields,'root');
  en(r.schema_version,['1.0.0'],'schema_version');
  const meta=obj(r.report,['id','generated_at','analyzer_version','mode','status','demo'],'report');
  str(meta.id,'report.id');str(meta.generated_at,'report.generated_at');
  const stamp=meta.generated_at as string;
  const match=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(Z|[+-](\d\d):(\d\d))$/.exec(stamp);
  if(!match||!Number.isFinite(Date.parse(stamp))) fail('report.generated_at');
  const [year,month,day,hour,minute,second]=match.slice(1,7).map(Number);
  const calendar=new Date(Date.UTC(year!,month!-1,day!));
  if(calendar.getUTCFullYear()!==year||calendar.getUTCMonth()+1!==month||calendar.getUTCDate()!==day||hour!>23||minute!>59||second!>59||Number(match[8]??0)>23||Number(match[9]??0)>59) fail('report.generated_at');
  str(meta.analyzer_version,'report.analyzer_version');if(!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(meta.analyzer_version as string)) fail('report.analyzer_version');en(meta.mode,['single_session','multi_session'],'report.mode');en(meta.status,['complete','partial'],'report.status');if(typeof meta.demo!=='boolean') fail('report.demo');
  const scope=obj(r.scope,['session_ids','excluded_sessions'],'scope');const scoped=strings(scope.session_ids,'scope.session_ids');
  for(const x of arr(scope.excluded_sessions,'scope.excluded_sessions')) {const item=obj(x,['id','reason'],'excluded session');str(item.id,'excluded.id');str(item.reason,'excluded.reason');}
  const cov=obj(r.coverage,['usage','limitations'],'coverage');en(cov.usage,coverage,'coverage.usage');strings(cov.limitations,'coverage.limitations');
  const sum=obj(r.summary,['session_count','tool_call_count','finding_count','input_tokens','output_tokens','total_tokens'],'summary');
  for(const k of ['session_count','tool_call_count','finding_count']) count(sum[k],'summary.'+k);
  for(const k of ['input_tokens','output_tokens','total_tokens']) nullable(sum[k],count,'summary.'+k);
  const sessions=arr(r.sessions,'sessions');
  for(const x of sessions) {
    const sessionFields=['id','agent','agent_version','started_at','ended_at','parent_id','relationship','usage','coverage','metrics','model_runs','timeline'];if(x&&typeof x==='object'&&Object.hasOwn(x,'source')) sessionFields.push('source');const s=obj(x,sessionFields,'session');
    if(s.source!==undefined){const source=obj(s.source,['format','fingerprint','normalized_sha256'],'session.source');for(const k of Object.keys(source)) str(source[k],'session.source.'+k);}
    str(s.id,'session.id');en(s.agent,['codex','claude_code','hermes'],'session.agent');
    for(const k of ['agent_version','started_at','ended_at','parent_id','relationship']) nullable(s[k],str,'session.'+k);
    usage(s.usage,'session.usage');const fields=['usage','tools','limitations'];if(s.coverage&&typeof s.coverage==='object'&&Object.hasOwn(s.coverage,'observations')) fields.push('observations');const c=obj(s.coverage,fields,'session.coverage');
    if(c.observations!==undefined){const o=obj(c.observations,['errors','skill_loads','usage_granularity','source_context'],'observations');en(o.errors,coverage,'observations.errors');en(o.skill_loads,coverage,'observations.skill_loads');en(o.usage_granularity,['request','session','unavailable'],'observations.usage_granularity');if(typeof o.source_context!=='boolean') fail('observations.source_context');}
    en(c.usage,coverage,'session.coverage.usage');en(c.tools,['observed','unavailable'],'session.coverage.tools');strings(c.limitations,'session.coverage.limitations');
    const m=obj(s.metrics,['tool_call_count','tool_error_count','skill_load_count','event_count'],'session.metrics');for(const k of Object.keys(m)) count(m[k],'session.metrics.'+k);
    for(const x of arr(s.model_runs,'model_runs')) {const run=obj(x,['model','provider'],'model_run');nullable(run.model,str,'model_run.model');nullable(run.provider,str,'model_run.provider');}
    for(const x of arr(s.timeline,'timeline')) {const e=obj(x,['event_id','type','timestamp','tool_name','source_ref'],'timeline');str(e.event_id,'timeline.event_id');en(e.type,events,'timeline.type');nullable(e.timestamp,str,'timeline.timestamp');nullable(e.tool_name,str,'timeline.tool_name');str(e.source_ref,'timeline.source_ref');}
  }
  const sids=unique(sessions,'sessions');
  if(scoped.length!==sids.size||new Set(scoped).size!==sids.size||scoped.some(id=>!sids.has(id))||sum.session_count!==sids.size) fail('session counts or scope');
  if(sum.tool_call_count!==sessions.reduce<number>((n,s)=>n+(s as Report['sessions'][number]).metrics.tool_call_count,0)) fail('tool call count');
  const findings=arr(r.findings,'findings'), recommendations=arr(r.recommendations,'recommendations'), candidates=arr(r.skill_candidates,'skill_candidates'), evidence=arr(r.evidence,'evidence');
  if(sum.finding_count!==findings.length) fail('finding count');
  if(cov.usage==='reported'&&sessions.some(s=>(s as Report['sessions'][number]).coverage.usage!=='reported'||(s as Report['sessions'][number]).usage.total_tokens===null)) fail('reported coverage');
  if(cov.usage==='unavailable'&&sessions.some(s=>(s as Report['sessions'][number]).usage.total_tokens!==null)) fail('unavailable coverage');
  const metrics=obj(r.metrics,['tools','skills'],'metrics');
  for(const x of arr(metrics.tools,'metrics.tools')) {const t=obj(x,['name','calls','errors','output_chars'],'tool metric');str(t.name,'tool.name');for(const k of ['calls','errors','output_chars']) count(t[k],'tool.'+k);}
  for(const x of arr(metrics.skills,'metrics.skills')) {const t=obj(x,['name','loads','states'],'skill metric');str(t.name,'skill.name');count(t.loads,'skill.loads');for(const state of strings(t.states,'skill.states')) en(state,['invoked','loaded','applied','unknown'],'skill.state');}
  const evids=unique(evidence,'evidence');const timelines=new Map(sessions.map(x=>{const s=x as Report['sessions'][number];return [s.id,new Set(s.timeline.map(e=>e.event_id))] as const;}));
  for(const x of evidence) {const e=obj(x,['id','session_id','event_id','source_ref','description','excerpt'],'evidence');for(const k of ['id','session_id','event_id','source_ref','description']) str(e[k],'evidence.'+k);nullable(e.excerpt,str,'evidence.excerpt');if(!sids.has(e.session_id as string)||!timelines.get(e.session_id as string)?.has(e.event_id as string)) fail('evidence reference');}
  const finds=unique(findings,'findings'), recs=unique(recommendations,'recommendations');unique(candidates,'skill_candidates');
  const evidenceSessions=new Map(evidence.map(x=>{const e=x as Report['evidence'][number];return [e.id,e.session_id];}));
  for(const x of findings) {const f=obj(x,['id','category','rule_id','title','severity','claim_type','confidence','session_ids','evidence_ids','observation','interpretation','recommendation_ids'],'finding');
    for(const k of ['id','rule_id','title','observation','interpretation']) str(f[k],'finding.'+k);
    en(f.category,categories,'finding.category');en(f.severity,['low','medium','high'],'finding.severity');en(f.claim_type,['observed','inferred'],'finding.claim_type');en(f.confidence,['low','medium','high'],'finding.confidence');
    const ss=refs(f.session_ids,sids,'finding.session_ids'), ee=refs(f.evidence_ids,evids,'finding.evidence_ids');refs(f.recommendation_ids,recs,'finding.recommendation_ids');
    if(ee.some(id=>!ss.includes(evidenceSessions.get(id)!))) fail('finding evidence session mismatch');
  }
  for(const x of recommendations) {const rec=obj(x,['id','title','action','kind','priority','finding_ids','overlap_group'],'recommendation');for(const k of ['id','title','action']) str(rec[k],'recommendation.'+k);en(rec.kind,['skill','script','template','instruction','workflow','investigate'],'recommendation.kind');en(rec.priority,['low','medium','high'],'recommendation.priority');refs(rec.finding_ids,finds,'recommendation.finding_ids');nullable(rec.overlap_group,str,'recommendation.overlap_group');}
  for(const x of candidates) {const c=obj(x,['id','title','trigger','session_ids','evidence_ids','recommendation','rationale','acceptance_tests'],'candidate');for(const k of ['id','title','trigger','rationale']) str(c[k],'candidate.'+k);const ss=refs(c.session_ids,sids,'candidate.session_ids'),ee=refs(c.evidence_ids,evids,'candidate.evidence_ids');if(ee.some(id=>!ss.includes(evidenceSessions.get(id)!))) fail('candidate evidence session mismatch');en(c.recommendation,['create','extend','merge','defer'],'candidate.recommendation');strings(c.acceptance_tests,'candidate.acceptance_tests');}
  const analysis=obj(r.analysis_usage,['mode','model_tokens','notes'],'analysis_usage');en(analysis.mode,['metrics_only','assisted'],'analysis_usage.mode');nullable(analysis.model_tokens,count,'analysis_usage.model_tokens');strings(analysis.notes,'analysis_usage.notes');
  if(r.provenance!==undefined){
    const p=obj(r.provenance,['analyzer','instructions','interpretations'],'provenance');const a=obj(p.analyzer,['version','revision','build_sha256'],'provenance.analyzer');str(a.version,'analyzer.version');if(a.version!==meta.analyzer_version) fail('analyzer.version');nullable(a.revision,str,'analyzer.revision');str(a.build_sha256,'analyzer.build');
    const instructions=obj(p.instructions,['skill_sha256','guide_sha256'],'provenance.instructions');for(const k of Object.keys(instructions)) str(instructions[k],'instructions');
    for(const item of arr(p.interpretations,'interpretations')){const i=obj(item,['model','instruction_sha256','packet_sha256','max_chars','context_event_ids','model_tokens'],'interpretation provenance');for(const k of ['model','instruction_sha256','packet_sha256']) nullable(i[k],str,k);nullable(i.max_chars,count,'max_chars');nullable(i.model_tokens,count,'model_tokens');const eventIds=new Set(sessions.flatMap(s=>(s as Report['sessions'][number]).timeline.map(e=>e.event_id)));refs(i.context_event_ids,eventIds,'context_event_ids');}
  }
  const privacy=obj(r.privacy,['raw_transcripts_included','excerpts_included','redaction_applied','safe_to_share'],'privacy');
  if(privacy.raw_transcripts_included!==false||privacy.safe_to_share!==null||typeof privacy.excerpts_included!=='boolean'||typeof privacy.redaction_applied!=='boolean') fail('privacy');
  if(!privacy.excerpts_included&&evidence.some(x=>(x as Report['evidence'][number]).excerpt!==null)) fail('excerpts not opted in');
}
