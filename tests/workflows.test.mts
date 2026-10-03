import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cases} from '../evaluations/cases.mjs';
import {analyze,selectContext,mergeInterpretation} from '../dist/core.js';
import {reviewOutcome} from '../dist/episodes.js';
import {assessWorkflows} from '../dist/workflows.js';
import {createFeedback,feedbackDraft,appendFeedback} from '../dist/feedback.js';
function source(id,text){const s=structuredClone(cases.find(c=>c.id==='same-retries').sessions[0]);s.id=id;s.source.fingerprint=id;s.events[0].text=text;return s;}
function selected(a,b){let r=analyze([a,b]);for(const s of [a,b])r=selectContext(r,s,[`${s.agent}:${s.id}:request`],true);return r;}
function assessment(r,kind='skill'){return {id:'selected-workflow',title:'Verified generated-source review',trigger:'Review a generated source artifact',kind,episode_ids:r.episodes.map(e=>e.id),evidence_ids:[...new Set(r.episodes.flatMap(e=>e.evidence_ids))],equivalent:true,conditions:'Selected generated files with the same verification contract',decisions:'Decide whether generation is required, inspect result and check verification',outputs:'Reviewed generated source with verification evidence',applicability:'Selected generated-source tasks only; broader audits need separate checks',uncertainty:'Equivalence is reviewer inference; benefits outside selected trials unknown',acceptance_tests:['Generate first only where prerequisites require it; preserve verification and handle incomplete sources'],existing_skill_id:null};}
test('analyzer invocations are excluded without removing legitimate development tasks or punctuation differences',()=>{
  for(const text of ['Use session-analysis to review this session.','$session-analysis','Analyze these sessions using session-analysis'])assert.equal(analyze([source('a',text),source('b',text)]).skill_candidates.length,0);
  for(const text of ['Implement the parser in session-analysis','Use session-analysis code to fix its adapter'])assert.equal(analyze([source('a',text),source('b',text)]).skill_candidates.length,1);
  assert.equal(analyze([source('a','Review foo.bar'),source('b','Review foobar')]).skill_candidates.length,0);
  assert.equal(analyze([source('a','Review C++ code'),source('b','Review C code')]).skill_candidates.length,0);
});
test('varied wording can be explicitly grouped but stays deferred without verified useful outcomes',()=>{
  const r=selected(source('a','Review the generated source.'),source('b','Check this generated artifact and its tests.')),g=assessment(r);
  const result=assessWorkflows(r,{groups:[g]});assert.equal(result.skill_candidates.at(-1).recommendation,'defer');assert.equal(result.recommendations.length,0);assert.equal(result.findings.at(-1).claim_type,'inferred');
  const rejected=assessWorkflows(r,{groups:[{...g,equivalent:false,conditions:'One task requires a whole-file audit; the other one symbol.'}]});assert.equal(rejected.skill_candidates.length,0);assert.equal(rejected.findings.length,r.findings.length);
  assert.throws(()=>assessWorkflows(r,{groups:[{...g,evidence_ids:['invented']}]}),/cite/);
  const analyzer=selected(source('a','Use session-analysis to review this session.'),source('b','Use session-analysis to review this session.'));assert.equal(assessWorkflows(analyzer,{groups:[assessment(analyzer)]}).skill_candidates.length,0);
});
test('actionable workflows require reviewed verification, relevant feedback and authorized overlap',()=>{
  let r=selected(source('a','Review generated source.'),source('b','Check generated artifact.'));
  for(const e of r.episodes)r=reviewOutcome(r,{episode_id:e.id,state:'verified',criteria:'Selected generated source passes the stated test',evidence_ids:e.verification_evidence_ids,reviewer:'synthetic reviewer'});
  const first=r.episodes[0];r=mergeInterpretation(r,{findings:[{id:'prior-f',category:'workflow_efficiency',rule_id:'prior-context',title:'Review generation',severity:'low',claim_type:'inferred',confidence:'medium',session_ids:[first.session_id],evidence_ids:first.evidence_ids,observation:'Synthetic prior contextual intervention',interpretation:'Verify selected source',recommendation_ids:['prior-r']}],recommendations:[{id:'prior-r',title:'Verify generation',action:'Synthetic prior action with correctness test',kind:'workflow',priority:'low',finding_ids:['prior-f'],overlap_group:null}]});
  const e=feedbackDraft(r,'prior-r');e.episode_ids=[first.id];e.review={decision:'accept',evidence_sufficient:true,correct:true,usefulness:4,reason:'Synthetic selected trial preserved correctness'};e.attempt={state:'attempted',change:'Generation prerequisites checked',correctness_test:'Generated source test passes'};e.follow_up={outcome:'improved',basis:'observed_test',correctness:'preserved',regressions:'none in synthetic test',additional_effort:'unmeasured',evidence_ids:first.verification_evidence_ids};
  const feedback=appendFeedback(r,createFeedback(r),e),g=assessment(r),metadata=[{id:'existing-review',title:'Existing generated-source review',applicability:'Generated-source tasks',source_sha256:'a'.repeat(64)}];
  const result=assessWorkflows(r,{groups:[{...g,existing_skill_id:'existing-review'}]},feedback,metadata);assert.equal(result.skill_candidates.at(-1).recommendation,'extend');assert.match(result.recommendations.at(-1).action,/Verification/);
  assert.throws(()=>assessWorkflows(r,{groups:[{...g,existing_skill_id:'not-authorized'}]},feedback,metadata),/explicitly/);
  for(const kind of ['script','template']){const result=assessWorkflows(r,{groups:[assessment(r,kind)]},feedback);assert.equal(result.recommendations.at(-1).kind,kind);assert.equal(result.skill_candidates.length,0);}
});
