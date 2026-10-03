import {createHash} from 'node:crypto';
import type {NormalizedEvent, NormalizedSession, Report, ReportSession, Finding, Recommendation, Evidence, SkillCandidate, Usage} from './types.js';
import {taskEpisodes} from './episodes.js';
import {BUILD} from './build-info.js';
import type {InterpretationProvenance} from './types.js';
import {validateReport} from './validation.js';

function canonical(value:unknown):string {return JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)??'null';}
function comparison(e:NormalizedEvent):unknown {
  if(e.comparison_arguments!==undefined) return e.comparison_arguments;
  if(typeof e.arguments==='string') {try {const value:unknown=JSON.parse(e.arguments);if(value&&typeof value==='object'&&!Array.isArray(value)) return value;}catch {}}
  return e.arguments??null;
}
function digest(value:unknown):string {return createHash('sha256').update(canonical(value)).digest('hex').slice(0,20);}
function sourceRef(e:NormalizedEvent):string {return /^(?:line|message|event|row):[A-Za-z0-9_.:-]{1,128}$/.test(e.source_ref)?e.source_ref:'event:'+digest(e.id);}
function redact(text:string):string {return text.replace(/https?:\/\/\S+/g,'[URL]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[EMAIL]').replace(/(?<!\w)(?:\/[^\s/]+){2,}/g,'[PATH]').replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]+/g,'[PATH]').replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g,'[TOKEN]');}
function excerpt(text:string):string {return redact(text).slice(0,240);}
const usageFields=(['input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','reasoning_tokens','total_tokens'] as const);
function isSessionControl(text:string):boolean {
  // Match before task-text normalization removes slash/markup distinctions.
  // Keep controls in the timeline, but do not treat session housekeeping as reusable work.
  const value=text.trim();
  return /^\/(?:clear|compact)(?:\s+[^\n]*)?$/i.test(value) ||
    /^<command-name>\/(?:clear|compact)<\/command-name>\s*(?:<command-message>[^<]*<\/command-message>\s*)?(?:<command-args>[\s\S]*?<\/command-args>\s*)?$/i.test(value);
}

/** Deterministic local rules, with no transcript excerpts unless explicitly requested. */
export function analyze(sessions:NormalizedSession[],includeExcerpts=false):Report {
  const excluded:Report['scope']['excluded_sessions']=[],seen=new Map<string,string>(), accepted:NormalizedSession[]=[];
  for(const s of sessions) {const id=s.agent+':'+s.id,prior=seen.get(id);if(prior!==undefined) excluded.push({id,reason:prior===s.source.fingerprint?'duplicate':'conflicting_identity'});else {seen.set(id,s.source.fingerprint);accepted.push(s);}}
  const resultSessions:ReportSession[]=accepted.map(s=>{
    const id=s.agent+':'+s.id,runs:ReportSession['model_runs']=[];
    for(const e of s.events) if(e.model) {const run={model:e.model,provider:e.provider??null};if(!runs.length||runs.at(-1)?.model!==run.model||runs.at(-1)?.provider!==run.provider) runs.push(run);}
    return {id,agent:s.agent,agent_version:s.agent_version,started_at:s.started_at,ended_at:s.ended_at,parent_id:s.parent_id?s.agent+':'+s.parent_id:null,relationship:s.relationship,
      source:{...s.source,normalized_sha256:createHash('sha256').update(canonical(s.events)).digest('hex')},usage:structuredClone(s.usage),coverage:{...structuredClone(s.coverage),limitations:s.coverage.limitations.map(redact)},
      metrics:{tool_call_count:s.events.filter(e=>e.type==='tool_call').length,tool_error_count:0,skill_load_count:0,event_count:s.events.length},model_runs:runs,
      timeline:s.events.map(e=>({event_id:id+':'+e.id,type:e.type,timestamp:e.timestamp,tool_name:e.tool_name??null,source_ref:sourceRef(e)}))};
  });
  const totals=Object.fromEntries(usageFields.map(k=>[k,resultSessions.some(s=>s.usage[k]!==null)?resultSessions.reduce((n,s)=>n+(s.usage[k]??0),0):null])) as unknown as Usage;
  const usage=usageFields.every(k=>totals[k]===null)?'unavailable':resultSessions.every(s=>s.coverage.usage==='reported'&&s.usage.total_tokens!==null)?'reported':'partial';
  const report:Report={schema_version:'1.0.0',provenance:{analyzer:{version:BUILD.version,revision:BUILD.revision,build_sha256:BUILD.build_sha256},instructions:{skill_sha256:BUILD.skill_sha256,guide_sha256:BUILD.guide_sha256},interpretations:[]},report:{id:'report:'+digest(sessions),generated_at:new Date().toISOString(),analyzer_version:BUILD.version,mode:resultSessions.length===1?'single_session':'multi_session',status:usage==='reported'&&!excluded.length&&accepted.every(s=>s.coverage.limitations.length===0)?'complete':'partial',demo:false},
    scope:{session_ids:resultSessions.map(s=>s.id),excluded_sessions:excluded},coverage:{usage,limitations:['Task outcomes are unknown; successful tool calls do not verify outcomes.']},
    summary:{session_count:resultSessions.length,tool_call_count:resultSessions.reduce((n,s)=>n+s.metrics.tool_call_count,0),finding_count:0,input_tokens:totals.input_tokens,output_tokens:totals.output_tokens,total_tokens:totals.total_tokens},
    sessions:resultSessions,metrics:{tools:[],skills:[]},findings:[],recommendations:[],skill_candidates:[],evidence:[],
    analysis_usage:{mode:'metrics_only',model_tokens:null,notes:['No model calls or monetary savings estimates.']},privacy:{raw_transcripts_included:false,excerpts_included:includeExcerpts,redaction_applied:includeExcerpts,safe_to_share:null}};
  const tools=new Map<string,Report['metrics']['tools'][number]>(),skills=new Map<string,Report['metrics']['skills'][number]>(),evidenceIds=new Set<string>();
  function evidence(sid:string,e:NormalizedEvent,description:string):string {const id='evidence:'+digest([sid,e.id]);if(!evidenceIds.has(id)){evidenceIds.add(id);report.evidence.push({id,session_id:sid,event_id:sid+':'+e.id,source_ref:sourceRef(e),description,excerpt:includeExcerpts&&e.text?excerpt(e.text):null});}return id;}
  function finding(rule:string,category:Finding['category'],sid:string,events:NormalizedEvent[],observation:string,interpretation:string):void {
    const id='finding:'+digest([rule,sid,events.map(e=>e.id)]);
    report.findings.push({id,category,rule_id:rule,title:rule.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase()),severity:'low',claim_type:'observed',confidence:'high',session_ids:[sid],evidence_ids:events.map(e=>evidence(sid,e,observation)),observation,interpretation,recommendation_ids:[]});
  }
  for(const [i,s] of accepted.entries()) {const target=resultSessions[i]!,sid=target.id;
    for(const limitation of target.coverage.limitations) {const note=sid+': '+limitation;if(!report.coverage.limitations.includes(note)) report.coverage.limitations.push(note);}
    if(s.coverage.tools==='unavailable') report.report.status='partial';
    const calls=new Map<string,NormalizedEvent[]>(), groups=new Map<string,NormalizedEvent[]>(),skillGroups=new Map<string,NormalizedEvent[]>();
    for(const e of s.events) {
      if(e.type==='skill') {const name=e.skill_name||'unknown',state=e.skill_state||'unknown';let item=skills.get(name);if(!item){item={name,loads:0,states:[]};skills.set(name,item);}if(!item.states.includes(state)) item.states.push(state);
        if(state==='loaded'){item.loads++;target.metrics.skill_load_count++;const group=skillGroups.get(name)??[];group.push(e);skillGroups.set(name,group);}}
      if(e.type==='tool_call') {const name=e.tool_name||'unknown';let item=tools.get(name);if(!item){item={name,calls:0,errors:0,output_chars:0};tools.set(name,item);}item.calls++;
        if(e.call_id){const group=calls.get(e.call_id)??[];group.push(e);calls.set(e.call_id,group);}
        const key=canonical([name,digest(comparison(e))]),group=groups.get(key)??[];group.push(e);groups.set(key,group);}
    }
    const failed=new Set<string>(),linkedResults=new Map<string,NormalizedEvent[]>();
    for(const e of s.events) {if(e.type!=='tool_result') continue;
      const matches=calls.get(e.call_id??'')??[];
      if(matches.length!==1){report.coverage.limitations.push('Unmatched or ambiguous tool result in '+sid+'; not attributed to a call.');report.report.status='partial';continue;}
      const call=matches[0]!,name=call.tool_name||'unknown',size=e.text.length;tools.get(name)!.output_chars+=size;
      const results=linkedResults.get(call.id)??[];results.push(e);linkedResults.set(call.id,results);
      if(e.is_error===true&&!failed.has(call.id)){failed.add(call.id);tools.get(name)!.errors++;}
      if(size>=10000) finding('large_tool_output','context_growth',sid,[call,e],`This tool result contains ${size} characters. Its token and cost impact were not measured separately.`,
        'Large output may be necessary; context and billing impact are unknown.');
    }
    target.metrics.tool_error_count=failed.size;
    const covered=new Set<string>();
    const callKey=(e:NormalizedEvent)=>canonical([e.tool_name,comparison(e)]);
    let pending:NormalizedEvent|null=null,episode:NormalizedEvent[]=[],episodeKey='',errorText='';
    function finish(recovery:NormalizedEvent[]=[]):void {
      if(episode.length>=4||(episode.length===2&&recovery.length)) {
        const events=[...episode,...recovery];
        for(const e of events) if(e.type==='tool_call') covered.add(e.id);
        finding(episode.length>=4?'repeated_failed_attempt':'failed_tool_call','tool_efficiency',sid,events,
          episode.length>=4?`${episode.length/2} contiguous calls share an exact tool name, canonical arguments and identical nonempty explicit error result text.`:'One linked tool call has an explicit error result, followed by an exact same-call retry with an explicit non-error result.',
          recovery.length?'Later explicit non-error result observed; task outcome remains unknown.':'No later explicit non-error result observed; task outcome remains unknown.');
      }
      episode=[];episodeKey='';errorText='';
    }
    // Only sequential, uniquely linked call/result pairs qualify. Concurrent or
    // ambiguous results do not establish a retry episode or unchanged state.
    for(const e of s.events) {
      if(e.type==='assistant'||e.type==='usage') continue;
      if(e.type==='tool_call') {
        if(pending||callKey(e)!==episodeKey) finish();
        pending=e;continue;
      }
      if(e.type!=='tool_result') {finish();pending=null;continue;}
      const call=pending;pending=null;
      if(!call||!call.tool_name||calls.get(e.call_id??'')?.[0]!==call||calls.get(e.call_id??'')?.length!==1||linkedResults.get(call.id)?.length!==1) {finish();continue;}
      if(e.is_error===true) {
        if(episode.length&&(e.text!==errorText||!e.text.trim().length)) finish();
        episodeKey=callKey(call);errorText=e.text;episode.push(call,e);
      } else finish(e.is_error===false?[call,e]:[]);
    }
    finish();
    for(const call of s.events) if(call.type==='tool_call'&&failed.has(call.id)&&!covered.has(call.id)) {
      const result=linkedResults.get(call.id)!.find(e=>e.is_error===true)!;
      finding('failed_tool_call','tool_efficiency',sid,[call,result],'One linked tool call has an explicit error result.','An error does not establish task failure or avoidable work.');
    }
    for(const all of groups.values()) {const group=all.filter(e=>!covered.has(e.id));if(group.length>=2) finding('repeated_tool_call','tool_efficiency',sid,group,`${group.length} calls share a tool name and argument hash.`,
      'Repeated calls are not proved unnecessary; state may have changed.');}
    for(const group of skillGroups.values()) if(group.length>=2) finding('repeated_skill_load','skill_usage',sid,group,`${group.length} loads of the same skill observed.`,
      'Repeated loads may be appropriate; no avoidable work is established.');
  }
  report.metrics.skills=[...skills.values()].sort((a,b)=>a.name.localeCompare(b.name));for(const s of report.metrics.skills)s.states.sort();
  report.metrics.tools=[...tools.values()].sort((a,b)=>a.name.localeCompare(b.name));
  const requests=new Map<string,Array<[string,NormalizedEvent]>>();
  for(const [i,s] of accepted.entries()) for(const e of s.events) if(e.type==='user') {
    if(isSessionControl(e.text))continue;
    const normalized=e.text.toLowerCase().split(/\s+/).join(' ').replace(/[^\p{L}\p{N}_\s]/gu,'').trim();
    if(normalized){const hash=digest(normalized),group=requests.get(hash)??[];group.push([resultSessions[i]!.id,e]);requests.set(hash,group);}
  }
  for(const [hash,occurrences] of requests) {const sids=[...new Set(occurrences.map(([sid])=>sid))];if(sids.length<2) continue;
    const evids=occurrences.map(([sid,e])=>evidence(sid,e,'Normalized user request recurs across sessions; content omitted.'));
    const id='finding:'+digest(['recurring_user_request',hash]);
    report.findings.push({id,category:'repeatable_tasks',rule_id:'recurring_user_request',title:'Recurring request candidate',severity:'low',claim_type:'inferred',confidence:'low',session_ids:sids,evidence_ids:evids,observation:'Matching normalized user requests observed in multiple sessions.',interpretation:'Potential repeatable workflow; usefulness and outcome are not verified.',recommendation_ids:[]});
    report.skill_candidates.push({id:'candidate:'+hash,title:'Recurring request candidate',trigger:'Repeated normalized request (hash '+hash+')',session_ids:sids,evidence_ids:evids,recommendation:'defer',rationale:'Candidate only; repeated wording does not prove reusable skill value.',acceptance_tests:['Confirm intent and usefulness manually before creating a skill.']});
  }
  report.summary.finding_count=report.findings.length;
  return report;
}

export interface EvidencePacket {
  schema_version:'1.0.0'; truncated:boolean;
  scope:Report['scope']; coverage:Report['coverage'];
  selection:{finding_ids:string[];session_ids:string[];omitted_findings:number;omitted_evidence:number;reason:string|null};
  findings:Finding[]; evidence:Evidence[]; episodes:NonNullable<Report['episodes']>; omitted_episodes:number;
}
/** Complete bundles in stable round-robin session order; never fill the budget with unused evidence. */
export function evidencePacket(report:Report,maxChars=12000,selection:{finding_ids?:string[];session_ids?:string[]}={}):EvidencePacket {
  if(!Number.isSafeInteger(maxChars)||maxChars<80) throw new Error('max_chars must be at least 80');
  for(const id of selection.finding_ids??[]) if(!report.findings.some(f=>f.id===id)) throw new Error('Unknown selected finding');
  for(const id of selection.session_ids??[]) if(!report.scope.session_ids.includes(id)) throw new Error('Unknown selected session');
  const eligible=report.findings.filter(f=>(!selection.finding_ids?.length||selection.finding_ids.includes(f.id))&&(!selection.session_ids?.length||f.session_ids.some(id=>selection.session_ids!.includes(id))));
  const packet:EvidencePacket={schema_version:report.schema_version,truncated:false,scope:structuredClone(report.scope),coverage:structuredClone(report.coverage),
    selection:{finding_ids:selection.finding_ids??[],session_ids:selection.session_ids??[],omitted_findings:eligible.length,omitted_evidence:report.evidence.length,reason:null},findings:[],evidence:[],episodes:[],omitted_episodes:report.episodes?.length??0};
  const fits=()=>JSON.stringify(packet).length<=maxChars;
  // Essential coverage cannot silently disappear to satisfy an unusably tiny cap.
  packet.truncated=true;packet.selection.reason='budget or selection';
  if(!fits()) throw new Error('Budget too small for scope, coverage and selection metadata');
  const evids=new Map(report.evidence.map(e=>[e.id,e])),included=new Set<string>(),remaining=[...eligible];
  const ordered:Finding[]=[];
  while(remaining.length) for(const sid of report.scope.session_ids) {
    const i=remaining.findIndex(f=>f.session_ids.includes(sid));if(i>=0) ordered.push(remaining.splice(i,1)[0]!);
  }
  for(const f of ordered) {
    const needed=[...new Set(f.evidence_ids)].filter(id=>!included.has(id)).map(id=>evids.get(id)!);
    if(needed.some(e=>!e)) throw new Error('Finding references missing evidence');
    packet.findings.push(structuredClone(f));packet.evidence.push(...structuredClone(needed));
    packet.selection.omitted_findings--;packet.selection.omitted_evidence-=needed.length;
    if(!fits()) {packet.findings.pop();packet.evidence.splice(packet.evidence.length-needed.length);packet.selection.omitted_findings++;packet.selection.omitted_evidence+=needed.length;}
    else for(const e of needed) included.add(e.id);
  }
  for(const episode of report.episodes??[]) {
    if(selection.session_ids?.length&&!selection.session_ids.includes(episode.session_id)) continue;
    const needed=[...new Set(episode.evidence_ids)].filter(id=>!included.has(id)).map(id=>evids.get(id)!);
    packet.episodes.push(structuredClone(episode));packet.evidence.push(...structuredClone(needed));packet.omitted_episodes--;packet.selection.omitted_evidence-=needed.length;
    if(!fits()){packet.episodes.pop();packet.evidence.splice(packet.evidence.length-needed.length);packet.omitted_episodes++;packet.selection.omitted_evidence+=needed.length;}else for(const e of needed) included.add(e.id);
  }
  // Registered contextual evidence can be useful even in an ordinary unflagged task.
  for(const e of report.evidence) if(!included.has(e.id)&&(!selection.session_ids?.length||selection.session_ids.includes(e.session_id))&&e.description.startsWith('Selected context:')) {
    packet.evidence.push(structuredClone(e));packet.selection.omitted_evidence--;
    if(!fits()){packet.evidence.pop();packet.selection.omitted_evidence++;}else included.add(e.id);
  }
  packet.truncated=packet.selection.omitted_findings>0||packet.selection.omitted_evidence>0||packet.omitted_episodes>0;
  packet.selection.reason=packet.truncated?'budget or selection':null;
  if(!fits()) throw new Error('Budget too small for omission metadata');
  return packet;
}

/** Register only explicitly selected source context, verified against the imported timeline. */
export function selectContext(report:Report,source:NormalizedSession,eventIds:string[],includeExcerpts=false):Report {
  validateReport(report);
  const sid=source.agent+':'+source.id,target=report.sessions.find(s=>s.id===sid);
  if(!target) throw new Error('Source session does not match report');
  if(!target.source) throw new Error('Legacy report lacks source fingerprint; regenerate before registering context');
  if(target.source.fingerprint!==source.source.fingerprint||target.source.normalized_sha256!==createHash('sha256').update(canonical(source.events)).digest('hex')) throw new Error('Source fingerprint does not match report');
  const timeline=source.events.map(e=>({event_id:sid+':'+e.id,type:e.type,timestamp:e.timestamp,tool_name:e.tool_name??null,source_ref:sourceRef(e)}));
  if(canonical(timeline)!==canonical(target.timeline)) throw new Error('Source timeline does not match report');
  if(new Set(source.events.map(e=>e.id)).size!==source.events.length) throw new Error('Ambiguous duplicate source event IDs');
  if(!eventIds.length) throw new Error('Select at least one event');
  const selected=new Set<number>(),notes:string[]=[];
  for(const id of eventIds) {
    const i=source.events.findIndex(e=>sid+':'+e.id===id);if(i<0) throw new Error('Selected event not in source session');
    selected.add(i);const event=source.events[i]!;
    if(event.type==='tool_call'||event.type==='tool_result') {
      const matches=source.events.map((e,j)=>({e,j})).filter(({e})=>e.call_id===event.call_id&&['tool_call','tool_result'].includes(e.type));
      if(!event.call_id||matches.filter(({e})=>e.type==='tool_call').length!==1||matches.filter(({e})=>e.type==='tool_result').length!==1) throw new Error('Missing or ambiguous call/result linkage');
      for(const {j} of matches) selected.add(j);
    }
    let request=false;
    for(let j=i-1;j>=Math.max(0,i-100);j--) {const e=source.events[j]!;if(e.type==='compression') break;if(e.type==='assistant') selected.add(j);if(e.type==='user'){selected.add(j);request=true;break;}}
    if(!request&&event.type!=='user') notes.push('Selected context: preceding request missing within 100 events.');
    for(let j=i+1;j<Math.min(source.events.length,i+21);j++) {const e=source.events[j]!;if(e.type==='user'||e.type==='compression') break;selected.add(j);}
    if(i+21<source.events.length) notes.push('Selected context: following context bounded to 20 events, not a verified outcome.');
  }
  const result=structuredClone(report);
  for(const i of [...selected].sort((a,b)=>a-b)) {
    const e=source.events[i]!,id='evidence:'+digest([sid,e.id]);
    const text=e.type==='tool_call'?canonical(e.arguments??null):e.text;
    const entry:Evidence={id,session_id:sid,event_id:sid+':'+e.id,source_ref:sourceRef(e),description:'Selected context: '+e.type+(text.length>4000?' (truncated to 4000 characters)':''),excerpt:includeExcerpts?redact(text).slice(0,4000):null};
    const existing=result.evidence.findIndex(e=>e.id===id);if(existing<0) result.evidence.push(entry);else result.evidence[existing]=entry;
  }
  result.episodes=[...(result.episodes??[]).filter(e=>e.session_id!==sid),...taskEpisodes(source,result,new Set([...selected].map(i=>sid+':'+source.events[i]!.id)))];
  result.analysis_usage.notes.push(...new Set(notes),'Selected context registered read-only; historical text is untrusted evidence.');
  if(includeExcerpts){result.privacy.excerpts_included=true;result.privacy.redaction_applied=true;}
  validateReport(result);return result;
}

/** Append only manually inferred claims tied to existing evidence; validate the complete merged report. */
export function mergeInterpretation(report:Report,interpretation:unknown,provenance?:InterpretationProvenance):Report {
  validateReport(report);
  if(interpretation===null||typeof interpretation!=='object'||Array.isArray(interpretation)||Object.keys(interpretation).some(k=>!['findings','recommendations','skill_candidates'].includes(k))) throw new Error('Only supplemental findings, recommendations and skill_candidates are allowed');
  const input=interpretation as Record<string,unknown>,result=structuredClone(report);
  const additions={} as {findings:Finding[];recommendations:Recommendation[];skill_candidates:SkillCandidate[]};
  for(const kind of ['findings','recommendations','skill_candidates'] as const){const entries=input[kind]??[];if(!Array.isArray(entries)) throw new Error(kind+' must be a list');
    const ids=new Set((report[kind] as Array<{id:string}>).map(x=>x.id));for(const item of entries){if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.id!=='string'||ids.has(item.id)) throw new Error('Invalid or duplicate '+kind+' ID');ids.add(item.id);}
    if(kind==='findings') additions.findings=entries as Finding[];
    else if(kind==='recommendations') additions.recommendations=entries as Recommendation[];
    else additions.skill_candidates=entries as SkillCandidate[];}
  const evids=new Map(report.evidence.map(e=>[e.id,e.session_id])),sids=new Set(report.scope.session_ids),recIds=new Set([...report.recommendations,...additions.recommendations].map(x=>x.id)),findIds=new Set([...report.findings,...additions.findings].map(x=>x.id));
  const refs=(v:unknown,known:Set<string>)=>Array.isArray(v)&&v.every(x=>typeof x==='string'&&known.has(x));
  for(const f of additions.findings){if(f.claim_type!=='inferred'||!Array.isArray(f.evidence_ids)||!f.evidence_ids.length||!Array.isArray(f.session_ids)||!f.session_ids.length||!refs(f.evidence_ids,new Set(evids.keys()))||!refs(f.session_ids,sids)||!refs(f.recommendation_ids,recIds)||f.evidence_ids.some(id=>!f.session_ids.includes(evids.get(id)!))) throw new Error('Supplemental findings must be inferred and evidenced');}
  for(const rec of additions.recommendations) if(!Array.isArray(rec.finding_ids)||!rec.finding_ids.length||!refs(rec.finding_ids,findIds)) throw new Error('Recommendation references unknown findings');
  for(const c of additions.skill_candidates) if(!Array.isArray(c.evidence_ids)||!c.evidence_ids.length||!Array.isArray(c.session_ids)||!c.session_ids.length||!refs(c.evidence_ids,new Set(evids.keys()))||!refs(c.session_ids,sids)||c.evidence_ids.some(id=>!c.session_ids.includes(evids.get(id)!))) throw new Error('Candidate references unknown evidence or sessions');
  const record:InterpretationProvenance=provenance??{model:null,instruction_sha256:null,packet_sha256:null,max_chars:null,context_event_ids:[],model_tokens:null};
  if(!result.provenance) result.provenance={analyzer:{version:report.report.analyzer_version,revision:null,build_sha256:'unknown'},instructions:{skill_sha256:'unknown',guide_sha256:'unknown'},interpretations:[]};
  result.provenance.interpretations.push(structuredClone(record));
  result.analysis_usage.model_tokens=record.model_tokens;
  result.findings.push(...structuredClone(additions.findings));result.recommendations.push(...structuredClone(additions.recommendations));result.skill_candidates.push(...structuredClone(additions.skill_candidates));
  result.summary.finding_count=result.findings.length;result.analysis_usage.mode='assisted';result.analysis_usage.notes.push('Manual interpretation added; inferred claims are not measured savings.');
  validateReport(result);return result;
}
