import type {Report} from './types.js';
import {validateReport} from './validation.ts';
import {fingerprint} from './identity.ts';
export interface FeedbackEntry {
  id:string; supersedes:string|null; recommendation_id:string; recommendation_sha256:string;
  finding_ids:string[]; episode_ids:string[]; reviewer:string; recorded_at:string;
  review:{decision:'accept'|'reject'|'defer';evidence_sufficient:boolean|null;correct:boolean|null;usefulness:number|null;reason:string};
  attempt:{state:'not_attempted'|'attempted'|'unknown';change:string;correctness_test:string};
  follow_up:{outcome:'improved'|'unchanged'|'worse'|'unknown';basis:'user_report'|'observed_test'|'model_inference';correctness:'preserved'|'regression'|'unknown';regressions:string;additional_effort:string;evidence_ids:string[]}|null;
}
export interface FeedbackFile {
  feedback_version:'1.0.0';report_id:string;report_sha256:string;
  analysis_revision:Report['provenance']|null;entries:FeedbackEntry[];
}
export function reportFingerprint(report:Report):string {
  const copy=structuredClone(report);copy.report.generated_at='';return fingerprint(copy);
}
export function createFeedback(report:Report):FeedbackFile {
  validateReport(report);return {feedback_version:'1.0.0',report_id:report.report.id,report_sha256:reportFingerprint(report),analysis_revision:structuredClone(report.provenance??null),entries:[]};
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function fields(v:unknown,keys:string[]):asserts v is Record<string,unknown> {if(!object(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))) throw new Error('Invalid feedback fields');}
function text(v:unknown):asserts v is string {if(typeof v!=='string')throw new Error('Invalid feedback text');}
function choice(v:unknown,values:string[]):void {if(typeof v!=='string'||!values.includes(v))throw new Error('Invalid feedback state');}
function refs(v:unknown,known:Set<string>):asserts v is string[] {if(!Array.isArray(v)||new Set(v).size!==v.length||v.some(id=>typeof id!=='string'||!known.has(id)))throw new Error('Unknown or duplicate feedback references');}
export function validateFeedback(report:Report,value:unknown):asserts value is FeedbackFile {
  validateReport(report);fields(value,['feedback_version','report_id','report_sha256','analysis_revision','entries']);
  if(value.feedback_version!=='1.0.0'||value.report_id!==report.report.id||value.report_sha256!==reportFingerprint(report)||fingerprint(value.analysis_revision)!==fingerprint(report.provenance??null))throw new Error('Stale feedback: report identity or analysis revision changed');
  if(!Array.isArray(value.entries))throw new Error('Feedback entries must be a list');
  const ids=new Set<string>(),superseded=new Set<string>(),findings=new Set(report.findings.map(f=>f.id)),episodes=new Set((report.episodes??[]).map(e=>e.id)),evidence=new Set(report.evidence.map(e=>e.id));
  const previous=new Map<string,FeedbackEntry>();
  for(const raw of value.entries){
    fields(raw,['id','supersedes','recommendation_id','recommendation_sha256','finding_ids','episode_ids','reviewer','recorded_at','review','attempt','follow_up']);
    for(const k of ['id','recommendation_id','recommendation_sha256','reviewer','recorded_at'])text(raw[k]);
    if(!raw.id||ids.has(raw.id as string))throw new Error('Duplicate feedback ID');ids.add(raw.id as string);
    if(!/^\d{4}-\d\d-\d\dT/.test(raw.recorded_at as string)||!Number.isFinite(Date.parse(raw.recorded_at as string)))throw new Error('Invalid feedback timestamp');
    const rec=report.recommendations.find(r=>r.id===raw.recommendation_id);if(!rec||raw.recommendation_sha256!==fingerprint(rec))throw new Error('Stale or unknown recommendation');
    refs(raw.finding_ids,findings);if(fingerprint([...raw.finding_ids].sort())!==fingerprint([...rec.finding_ids].sort()))throw new Error('Feedback findings do not match recommendation');
    refs(raw.episode_ids,episodes);
    const recEvidence=new Set(report.findings.filter(f=>rec.finding_ids.includes(f.id)).flatMap(f=>f.evidence_ids));
    if(raw.episode_ids.some(id=>!report.episodes!.find(e=>e.id===id)!.evidence_ids.some(id=>recEvidence.has(id))))throw new Error('Feedback episode unrelated to recommendation');
    if(raw.supersedes!==null){text(raw.supersedes);const prior=previous.get(raw.supersedes);if(!prior||prior.recommendation_id!==raw.recommendation_id||superseded.has(raw.supersedes))throw new Error('Invalid feedback revision chain');superseded.add(raw.supersedes);}
    fields(raw.review,['decision','evidence_sufficient','correct','usefulness','reason']);choice(raw.review.decision,['accept','reject','defer']);
    for(const k of ['evidence_sufficient','correct'])if(raw.review[k]!==null&&typeof raw.review[k]!=='boolean')throw new Error('Invalid review assessment');
    if(raw.review.usefulness!==null&&(!Number.isInteger(raw.review.usefulness)||Number(raw.review.usefulness)<1||Number(raw.review.usefulness)>5))throw new Error('Usefulness must be 1–5 or unknown');text(raw.review.reason);if(!raw.review.reason.trim())throw new Error('Feedback reason required');
    fields(raw.attempt,['state','change','correctness_test']);choice(raw.attempt.state,['not_attempted','attempted','unknown']);text(raw.attempt.change);text(raw.attempt.correctness_test);
    if(raw.attempt.state==='attempted'&&(!raw.attempt.change.trim()||!raw.attempt.correctness_test.trim()))throw new Error('Attempt requires a change and correctness test');
    if(raw.follow_up!==null){fields(raw.follow_up,['outcome','basis','correctness','regressions','additional_effort','evidence_ids']);choice(raw.follow_up.outcome,['improved','unchanged','worse','unknown']);choice(raw.follow_up.basis,['user_report','observed_test','model_inference']);choice(raw.follow_up.correctness,['preserved','regression','unknown']);text(raw.follow_up.regressions);text(raw.follow_up.additional_effort);refs(raw.follow_up.evidence_ids,evidence);
      if(raw.attempt.state!=='attempted')throw new Error('Follow-up requires an explicit attempt');if(raw.follow_up.basis==='observed_test'&&!raw.follow_up.evidence_ids.length)throw new Error('Observed follow-up requires evidence');}
    previous.set(raw.id as string,raw as unknown as FeedbackEntry);
  }
}
export function appendFeedback(report:Report,file:FeedbackFile,entry:FeedbackEntry):FeedbackFile {
  validateFeedback(report,file);const result=structuredClone(file);result.entries.push(structuredClone(entry));validateFeedback(report,result);return result;
}
export function feedbackDraft(report:Report,recommendationId:string):FeedbackEntry {
  const rec=report.recommendations.find(r=>r.id===recommendationId);if(!rec)throw new Error('Unknown recommendation');
  return {id:'feedback:'+globalThis.crypto.randomUUID(),supersedes:null,recommendation_id:rec.id,recommendation_sha256:fingerprint(rec),finding_ids:[...rec.finding_ids],episode_ids:[],reviewer:'anonymous',recorded_at:new Date().toISOString(),review:{decision:'defer',evidence_sufficient:null,correct:null,usefulness:null,reason:''},attempt:{state:'not_attempted',change:'',correctness_test:''},follow_up:null};
}
