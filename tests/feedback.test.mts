import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createFeedback,feedbackDraft,appendFeedback,validateFeedback,reportFingerprint} from '../dist/feedback.js';
import {sha256} from '../dist/identity.js';
import {mergeInterpretation} from '../dist/core.js';
const run=JSON.parse(readFileSync(new URL('../evaluations/contextual/run.json',import.meta.url),'utf8'));
const outputs=JSON.parse(readFileSync(new URL('../evaluations/contextual/outputs.json',import.meta.url),'utf8'));
export function reviewedReport(){const c=run.cases.find(c=>c.id==='ordinary-correction');return mergeInterpretation(c.report,outputs.outputs.find(c=>c.case_id==='ordinary-correction').interpretation);}
test('portable fingerprints match SHA-256 including Unicode and multi-block inputs',()=>{
  for(const s of ['','abc','Ada 🐈','x'.repeat(2000)])assert.equal(sha256(s),createHash('sha256').update(s).digest('hex'));
});
test('explicit feedback round trip preserves decisions separately from attempts and report data',()=>{
  const r=reviewedReport(),before=JSON.stringify(r),file=createFeedback(r);assert.equal(file.entries.length,0);
  const entry=feedbackDraft(r,r.recommendations[0].id);entry.review={decision:'accept',evidence_sufficient:true,correct:true,usefulness:4,reason:'Preserves the requested structure.'};
  const saved=appendFeedback(r,file,entry),roundTrip=JSON.parse(JSON.stringify(saved));validateFeedback(r,roundTrip);
  assert.equal(saved.entries[0].attempt.state,'not_attempted');assert.equal(saved.entries[0].follow_up,null);assert.equal(JSON.stringify(r),before);assert.equal(file.entries.length,0);
  const reexport=structuredClone(r);reexport.report.generated_at='2026-10-04T00:00:00Z';assert.equal(reportFingerprint(r),reportFingerprint(reexport));validateFeedback(reexport,saved);
  const changed=structuredClone(r);changed.recommendations[0].action+=' Changed';assert.throws(()=>validateFeedback(changed,saved),/Stale/);
  assert.throws(()=>appendFeedback(r,saved,entry),/Duplicate/);
  const revision=structuredClone(entry);revision.id='revision';revision.supersedes=entry.id;revision.review.decision='reject';const revised=appendFeedback(r,saved,revision);assert.equal(revised.entries.length,2);
  const follow=structuredClone(entry);follow.id='follow';follow.follow_up={outcome:'improved',basis:'user_report',correctness:'unknown',regressions:'',additional_effort:'',evidence_ids:[]};assert.throws(()=>appendFeedback(r,saved,follow),/attempt/);
});
