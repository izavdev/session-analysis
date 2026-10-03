import type {Report} from './types.js';
import type {FeedbackFile,FeedbackEntry} from './feedback.js';
import {validateFeedback,reportFingerprint} from './feedback.js';
import {validateReport} from './validation.js';
import {fingerprint} from './identity.js';
export interface ReviewedSample {report:Report;feedback:FeedbackFile;task_family?:string;}
function rate(numerator:number,denominator:number){
  if(!denominator)return {numerator,denominator,rate:null,interval_95:null};
  const p=numerator/denominator,z=1.96,d=1+z*z/denominator,center=(p+z*z/(2*denominator))/d,margin=z*Math.sqrt(p*(1-p)/denominator+z*z/(4*denominator*denominator))/d;
  return {numerator,denominator,rate:p,interval_95:[Math.max(0,center-margin),Math.min(1,center+margin)]};
}
function summarize(entries:FeedbackEntry[],total:number){
  const grounded=entries.filter(e=>e.review.evidence_sufficient!==null),correct=entries.filter(e=>e.review.correct!==null),ratings=entries.filter(e=>e.review.usefulness!==null),attempts=entries.filter(e=>e.attempt.state==='attempted'),follow=attempts.filter(e=>e.follow_up!==null);
  const outcomes=Object.fromEntries(['improved','unchanged','worse','unknown'].map(k=>[k,follow.filter(e=>e.follow_up!.outcome===k).length]));
  const negative=follow.filter(e=>e.follow_up!.outcome==='worse'||e.follow_up!.correctness==='regression');
  const recommendation=negative.length>=2&&negative.length===follow.length?'retire':negative.length?'revise':follow.some(e=>e.follow_up!.outcome==='improved'&&e.follow_up!.correctness==='preserved'&&e.follow_up!.basis==='observed_test')?'keep':'revisit';
  return {recommendations_in_scope:total,review_records:entries.length,context_insufficient:entries.filter(e=>e.review.evidence_sufficient===false).length,supported_reviews:rate(entries.filter(e=>e.review.evidence_sufficient===true&&e.review.correct===true).length,entries.filter(e=>e.review.evidence_sufficient!==null&&e.review.correct!==null).length),grounding:rate(grounded.filter(e=>e.review.evidence_sufficient).length,grounded.length),correctness:rate(correct.filter(e=>e.review.correct).length,correct.length),false_positive:rate(correct.filter(e=>e.review.correct===false).length,correct.length),grounding_unknown:entries.length-grounded.length,correctness_unknown:entries.length-correct.length,
    usefulness:{responses:ratings.length,missing:entries.length-ratings.length,distribution:Object.fromEntries([1,2,3,4,5].map(k=>[k,ratings.filter(e=>e.review.usefulness===k).length]))},
    decisions:Object.fromEntries(['accept','reject','defer'].map(k=>[k,entries.filter(e=>e.review.decision===k).length])),adoption:{attempted:attempts.length,not_attempted:entries.filter(e=>e.attempt.state==='not_attempted').length,unknown:entries.filter(e=>e.attempt.state==='unknown').length},
    follow_up:{attempted_denominator:attempts.length,recorded:follow.length,missing:attempts.length-follow.length,outcomes,by_basis:Object.fromEntries(['user_report','observed_test','model_inference'].map(b=>[b,Object.fromEntries(['improved','unchanged','worse','unknown'].map(k=>[k,follow.filter(e=>e.follow_up!.basis===b&&e.follow_up!.outcome===k).length]))]))},
    maintenance:{decision:recommendation,evidence_ids:negative.length?negative.map(e=>e.id):follow.map(e=>e.id),reason:negative.length?'Negative outcomes or correctness regressions require revision; conflicting evidence remains visible.':recommendation==='keep'?'At least one explicit observed-test follow-up reports improvement with correctness preserved; causal benefit remains unestablished.':'Insufficient observed follow-up to retain or retire an intervention.'},uncertainty:'Selected, potentially dependent reviews; Wilson intervals assume independent observations and are descriptive only. No causal or monetary savings claim.'};
}
export function analyzeFeedback(samples:ReviewedSample[],opportunities:Array<{id:string;found:boolean|null}>=[]) {
  const reports=new Map<string,Report>(),all=new Map<string,{report:Report;entry:FeedbackEntry;family:string}>();
  for(const sample of samples){validateFeedback(sample.report,sample.feedback);const key=reportFingerprint(sample.report);reports.set(key,sample.report);
    for(const entry of sample.feedback.entries){const id=key+':'+entry.id,prior=all.get(id);if(prior&&fingerprint(prior.entry)!==fingerprint(entry))throw new Error('Conflicting feedback IDs');all.set(id,{report:sample.report,entry,family:sample.task_family??'unknown'});}}
  const superseded=new Set([...all.values()].filter(x=>x.entry.supersedes).map(x=>reportFingerprint(x.report)+':'+x.entry.supersedes));
  const active=[...all.entries()].filter(([id])=>!superseded.has(id)).map(([,item])=>item);
  const reviewed=new Set(active.map(x=>reportFingerprint(x.report)+':'+x.entry.recommendation_id));
  const total=[...reports.values()].reduce((n,r)=>n+r.recommendations.length,0),groups=new Map<string,typeof active>();
  for(const item of active){const rec=item.report.recommendations.find(r=>r.id===item.entry.recommendation_id)!;
    const adapters=[...new Set(item.report.findings.filter(f=>rec.finding_ids.includes(f.id)).flatMap(f=>f.session_ids).map(id=>item.report.sessions.find(s=>s.id===id)!.agent))].sort();
    const key=JSON.stringify({analyzer:item.report.provenance?.analyzer??{version:item.report.report.analyzer_version,revision:null},instructions:item.report.provenance?.instructions??null,adapters,task_family:item.family,recommendation_family:rec.kind});
    const group=groups.get(key)??[];group.push(item);groups.set(key,group);}
  const opportunityIds=new Set<string>();for(const o of opportunities){if(!o.id||opportunityIds.has(o.id)||(o.found!==null&&typeof o.found!=='boolean'))throw new Error('Invalid opportunity review');opportunityIds.add(o.id);}
  const known=opportunities.filter(o=>o.found!==null);
  return {...summarize(active.map(x=>x.entry),total),reviewed_recommendations:reviewed.size,unreviewed_recommendations:total-reviewed.size,superseded_records:superseded.size,opportunities:{found:rate(known.filter(o=>o.found).length,known.length),missed:known.filter(o=>!o.found).map(o=>o.id),unreviewed:opportunities.filter(o=>o.found===null).map(o=>o.id)},slices:[...groups].map(([key,items])=>({group:JSON.parse(key),...summarize(items.map(x=>x.entry),new Set(items.map(x=>reportFingerprint(x.report)+':'+x.entry.recommendation_id)).size)}))};
}
export interface Trial {
  trial_version:'1.0.0';id:string;
  baseline_report_sha256:string;followup_report_sha256:string;
  baseline_episode_id:string;followup_episode_id:string;recommendation_id:string;
  intervention:string;correctness_criteria:string;comparable:boolean|null;
  task_complexity:string|null;concurrent_changes:string|null;
  outcome:'improved'|'unchanged'|'worse'|'unknown';basis:'user_report'|'observed_test'|'model_inference';correctness:'preserved'|'regression'|'unknown';verification_evidence_ids:string[];
}
export function compareTrial(baseline:Report,followup:Report,trial:Trial){
  validateReport(baseline);validateReport(followup);
  const keys=['trial_version','id','baseline_report_sha256','followup_report_sha256','baseline_episode_id','followup_episode_id','recommendation_id','intervention','correctness_criteria','comparable','task_complexity','concurrent_changes','outcome','basis','correctness','verification_evidence_ids'];
  if(!trial||Object.keys(trial).length!==keys.length||keys.some(k=>!Object.hasOwn(trial,k))||trial.trial_version!=='1.0.0'||trial.baseline_report_sha256!==reportFingerprint(baseline)||trial.followup_report_sha256!==reportFingerprint(followup))throw new Error('Invalid or stale selected trial');
  for(const k of ['id','intervention','correctness_criteria','baseline_episode_id','followup_episode_id','recommendation_id'] as const)if(typeof trial[k]!=='string'||!trial[k].trim())throw new Error('Trial details required');
  if(!['improved','unchanged','worse','unknown'].includes(trial.outcome)||!['user_report','observed_test','model_inference'].includes(trial.basis)||!['preserved','regression','unknown'].includes(trial.correctness)||![true,false,null].includes(trial.comparable)||[trial.task_complexity,trial.concurrent_changes].some(v=>v!==null&&typeof v!=='string'))throw new Error('Invalid trial assessment');
  const a=baseline.episodes?.find(e=>e.id===trial.baseline_episode_id),b=followup.episodes?.find(e=>e.id===trial.followup_episode_id);
  const rec=baseline.recommendations.find(r=>r.id===trial.recommendation_id);if(!a||!b||!rec||!baseline.findings.some(f=>rec.finding_ids.includes(f.id)&&f.evidence_ids.some(id=>a.evidence_ids.includes(id))))throw new Error('Trial references an unrelated or missing episode/recommendation');
  if(!Array.isArray(trial.verification_evidence_ids)||trial.verification_evidence_ids.some(id=>!b.verification_evidence_ids.includes(id))||(trial.basis==='observed_test'&&!trial.verification_evidence_ids.length))throw new Error('Trial lacks selected verification evidence');
  const sa=baseline.sessions.find(s=>s.id===a.session_id)!,sb=followup.sessions.find(s=>s.id===b.session_id)!;
  const differences:string[]=[];
  if(sa.agent!==sb.agent)differences.push('adapter changed');
  if(fingerprint(sa.model_runs)!==fingerprint(sb.model_runs))differences.push('model changed');
  if(!sa.model_runs.length||!sb.model_runs.length)differences.push('model identity unavailable');
  if(fingerprint(sa.coverage)!==fingerprint(sb.coverage))differences.push('telemetry coverage changed');
  if(fingerprint(baseline.provenance?.analyzer??null)!==fingerprint(followup.provenance?.analyzer??null))differences.push('analyzer build changed');
  if(fingerprint(baseline.provenance?.instructions??null)!==fingerprint(followup.provenance?.instructions??null))differences.push('instructions changed');
  if(trial.comparable!==true)differences.push('comparability not established');
  if(!trial.task_complexity)differences.push('task complexity unassessed');
  if(!trial.concurrent_changes||trial.concurrent_changes!=='none')differences.push('concurrent changes present or unknown');
  const complete=sa.coverage.usage==='reported'&&sb.coverage.usage==='reported'&&sa.usage.total_tokens!==null&&sb.usage.total_tokens!==null;
  const entireSession=(report:Report,episode:typeof a)=>report.episodes?.filter(e=>e.session_id===episode.session_id).length===1&&report.sessions.find(s=>s.id===episode.session_id)!.timeline.filter(e=>!['usage','skill'].includes(e.type)).every(e=>episode.evidence_ids.some(id=>report.evidence.find(x=>x.id===id)?.event_id===e.event_id));
  const comparable=differences.length===0;
  const tokens=complete&&comparable&&entireSession(baseline,a)&&entireSession(followup,b)?{baseline:sa.usage.total_tokens,followup:sb.usage.total_tokens,observed_difference:sb.usage.total_tokens!-sa.usage.total_tokens!}:null;
  const decision=trial.correctness==='regression'||trial.outcome==='worse'?'revise':trial.outcome==='improved'&&trial.correctness==='preserved'&&trial.basis==='observed_test'&&comparable?'keep':'revisit';
  return {trial_id:trial.id,comparable,differences,intervention:trial.intervention,correctness_criteria:trial.correctness_criteria,outcome:trial.outcome,basis:trial.basis,correctness:trial.correctness,verification_evidence_ids:trial.verification_evidence_ids,decision,usage:tokens,usage_limitation:tokens?null:'Complete comparable episode-wide usage unavailable; partial totals are not savings.',uncertainty:'Selected trial with explicit reviewer assessment; no causal attribution, subscription saving or statistical effectiveness claim.'};
}
