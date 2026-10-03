import {isAnalyzerActivity,isSessionControl} from './activity.js';
import {createHash} from 'node:crypto';
import type {NormalizedSession, Report, TaskEpisode} from './types.js';
import {validateReport} from './validation.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,20);
/** Episode boundaries are deterministic; correction language and completion are hints, not causal facts. */
export function taskEpisodes(source:NormalizedSession,report:Report,selected:Set<string>):TaskEpisode[] {
  const sid=source.agent+':'+source.id,episodes:TaskEpisode[]=[];
  const evidence=new Map(report.evidence.filter(e=>e.session_id===sid).map(e=>[e.event_id,e.id]));
  let current:TaskEpisode|undefined;
  for(const e of source.events) {
    const eid=sid+':'+e.id;
    if(e.type==='compression'){current=undefined;continue;}
    if(!selected.has(eid)) {current=undefined;continue;}
    const ref=evidence.get(eid);if(!ref) continue;
    const correction=e.type==='user'&&/\b(?:that is not|that's not|you missed|you forgot|instead of|please use the requested|not what I asked)\b/i.test(e.text);
    if(!current||(e.type==='user'&&!correction)) {
      current={id:'episode:'+hash([sid,e.id]),session_id:sid,request_kind:e.type==='user'?isAnalyzerActivity(e.text)?'analyzer':isSessionControl(e.text)?'control':'task':'unknown',request_evidence_id:e.type==='user'?ref:null,action_evidence_ids:[],correction_evidence_ids:[],verification_evidence_ids:[],evidence_ids:[],boundary:e.type==='user'?'request':'partial',limitations:e.type==='user'?[]:['Request missing or selection/compaction interrupted the episode.'],outcome:{state:'unknown',basis:'unassessed',criteria:null,evidence_ids:[],reviewer:null}};
      episodes.push(current);
    }
    current.evidence_ids.push(ref);
    if(correction){current.correction_evidence_ids.push(ref);current.limitations.push('Correction language is a heuristic; intent requires review.');}
    if(e.type==='tool_call'||e.type==='tool_result') current.action_evidence_ids.push(ref);
    if(e.type==='tool_result'&&e.is_error===false) {
      const call=source.events.filter(c=>c.type==='tool_call'&&c.call_id===e.call_id);
      if(call.length===1&&/\b(?:test|verify|check|validate)\b/i.test(JSON.stringify(call[0]!.arguments??call[0]!.tool_name))) {
        const callEvidence=evidence.get(sid+':'+call[0]!.id);
        if(callEvidence) current.verification_evidence_ids.push(callEvidence,ref);
        current.limitations.push('Non-error verification command is a candidate; criteria and task completeness require review.');
      }
    }
    if(e.type==='assistant'&&/\b(?:done|completed|confirmed|all .* checked)\b/i.test(e.text)&&current.outcome.state==='unknown') current.outcome={state:'claimed_complete',basis:'assistant_claim',criteria:null,evidence_ids:[ref],reviewer:null};
  }
  return episodes.map(e=>({...e,verification_evidence_ids:[...new Set(e.verification_evidence_ids)],limitations:[...new Set(e.limitations)]}));
}
/** Explicit reviewer assessment, never inferred from a successful exit code. */
export function reviewOutcome(report:Report,input:unknown):Report {
  validateReport(report);
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('Outcome review must be an object');
  const value=input as Record<string,unknown>;
  const keys=['episode_id','state','criteria','evidence_ids','reviewer'];
  if(Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))) throw new Error('Invalid outcome review fields');
  const episode=report.episodes?.find(e=>e.id===value.episode_id);if(!episode) throw new Error('Unknown selected episode');
  if(!['unknown','claimed_complete','verified','failed','blocked'].includes(String(value.state))||typeof value.criteria!=='string'||!value.criteria.trim()||typeof value.reviewer!=='string'||!value.reviewer.trim()||!Array.isArray(value.evidence_ids)||!value.evidence_ids.length||value.evidence_ids.some(id=>typeof id!=='string'||!episode.evidence_ids.includes(id))) throw new Error('Outcome requires criteria, reviewer and selected episode evidence');
  if(value.state==='verified'&&!value.evidence_ids.some(id=>episode.verification_evidence_ids.includes(id))) throw new Error('Verified outcome requires selected verification evidence');
  const result=structuredClone(report),target=result.episodes!.find(e=>e.id===episode.id)!;
  target.outcome={state:value.state as TaskEpisode['outcome']['state'],basis:'reviewer_assessment',criteria:value.criteria,evidence_ids:value.evidence_ids as string[],reviewer:value.reviewer};
  validateReport(result);return result;
}
