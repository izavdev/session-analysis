import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyze,selectContext,mergeInterpretation} from '../dist/core.js';
import {createFeedback,feedbackDraft,appendFeedback,reportFingerprint} from '../dist/feedback.js';
import {analyzeFeedback,compareTrial} from '../dist/feedback-analysis.js';
const run=JSON.parse(readFileSync(new URL('../evaluations/contextual/run.json',import.meta.url),'utf8'));
const outputs=JSON.parse(readFileSync(new URL('../evaluations/contextual/outputs.json',import.meta.url),'utf8'));
function baseline(){const c=run.cases.find(c=>c.id==='ordinary-correction');return mergeInterpretation(c.report,outputs.outputs.find(c=>c.case_id==='ordinary-correction').interpretation);}
function entry(r,id='a'){const e=feedbackDraft(r,r.recommendations[0].id);e.id=id;e.review.reason='Synthetic adjudication';return e;}
test('empty, contradictory and incomplete summaries keep truthful denominators and revision history',()=>{
  const empty=analyzeFeedback([]);assert.equal(empty.grounding.rate,null);assert.equal(empty.follow_up.attempted_denominator,0);
  const r=baseline(),a=entry(r);a.review.decision='accept';a.review.correct=true;a.review.evidence_sufficient=true;a.review.usefulness=4;
  let feedback=appendFeedback(r,createFeedback(r),a);let summary=analyzeFeedback([{report:r,feedback}],[{id:'missed',found:false},{id:'unknown',found:null}]);
  assert.equal(summary.reviewed_recommendations,1);assert.equal(summary.follow_up.recorded,0);assert.equal(summary.adoption.attempted,0);assert.equal(summary.opportunities.found.denominator,1);assert.equal(summary.opportunities.unreviewed.length,1);
  const b=entry(r,'b');b.supersedes='a';b.attempt={state:'attempted',change:'Format check',correctness_test:'Parse JSON and check keys'};feedback=appendFeedback(r,feedback,b);
  summary=analyzeFeedback([{report:r,feedback},{report:r,feedback}]);assert.equal(summary.superseded_records,1);assert.equal(summary.review_records,1);assert.equal(summary.follow_up.missing,1);assert.equal(summary.correctness.denominator,0);
  const c=entry(r,'c');c.reviewer='another reviewer';c.review.correct=false;c.review.reason='A false claim';feedback=appendFeedback(r,feedback,c);
  summary=analyzeFeedback([{report:r,feedback}]);assert.equal(summary.false_positive.numerator,1);assert.equal(summary.false_positive.denominator,1);assert.equal(summary.reviewed_recommendations,1);assert.equal(summary.review_records,2);
});
test('selected synthetic trial completes baseline, change, verification, feedback and maintenance loop',()=>{
  const r=baseline();const parsed=JSON.parse(JSON.stringify({name:'Ada',age:30}));assert.deepEqual(Object.keys(parsed).sort(),['age','name']);
  const source={id:'followup-format',agent:'codex',agent_version:null,source:{format:'synthetic-normalized',fingerprint:'synthetic-followup'},started_at:null,ended_at:null,parent_id:null,relationship:null,usage:r.sessions[0].usage,coverage:{usage:'unavailable',tools:'observed',limitations:['Synthetic trial, not a user effectiveness study.']},events:[
    {id:'u',type:'user',text:'Return JSON with keys name and age.',timestamp:null,source_ref:'event:u'},
    {id:'a',type:'assistant',text:JSON.stringify(parsed),timestamp:null,source_ref:'event:a'},
    {id:'c',type:'tool_call',tool_name:'validate_json',call_id:'c',arguments:{command:'validate JSON parseability and required keys'},text:'',timestamp:null,source_ref:'event:c'},
    {id:'r',type:'tool_result',call_id:'c',is_error:false,text:'PASS: JSON parses and has name and age; values unchanged.',timestamp:null,source_ref:'event:r'},
  ]};
  const follow=selectContext(analyze([source]),source,['codex:followup-format:u'],true),episode=follow.episodes[0];
  const trial={trial_version:'1.0.0',id:'synthetic-format-trial',baseline_report_sha256:reportFingerprint(r),followup_report_sha256:reportFingerprint(follow),baseline_episode_id:r.episodes[0].id,followup_episode_id:episode.id,recommendation_id:r.recommendations[0].id,intervention:'Serialize then parse JSON and check requested keys',correctness_criteria:'JSON parses with name and age and preserves values',comparable:true,task_complexity:'Same two fields in selected synthetic examples',concurrent_changes:'none',outcome:'improved',basis:'observed_test',correctness:'preserved',verification_evidence_ids:episode.verification_evidence_ids};
  const comparison=compareTrial(r,follow,trial);assert.equal(comparison.outcome,'improved');assert.equal(comparison.usage,null);assert.equal(comparison.decision,'revisit');assert.ok(comparison.differences.includes('model identity unavailable'));
  const e=entry(r);e.review.decision='accept';e.attempt={state:'attempted',change:trial.intervention,correctness_test:trial.correctness_criteria};e.follow_up={outcome:'unknown',basis:'user_report',correctness:'unknown',regressions:'not yet reviewed',additional_effort:'unknown',evidence_ids:[]};
  const file=appendFeedback(r,createFeedback(r),e);const summary=analyzeFeedback([{report:r,feedback:file,task_family:'structured output'}]);assert.equal(summary.follow_up.outcomes.unknown,1);assert.equal(summary.maintenance.decision,'revisit');
  assert.equal(compareTrial(r,follow,{...trial,outcome:'worse',correctness:'regression'}).decision,'revise');
  assert.throws(()=>compareTrial(r,follow,{...trial,followup_report_sha256:'changed'}),/stale/);
  assert.throws(()=>compareTrial(r,follow,{...trial,verification_evidence_ids:['fabricated']}),/verification/);
});
