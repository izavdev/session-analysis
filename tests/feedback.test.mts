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

test('CLI feedback template, append, validation, export and analysis round trip offline',async()=>{
  const {mkdtempSync,writeFileSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFileSync}=await import('node:child_process');
  const dir=mkdtempSync(join(tmpdir(),'feedback-cli-')),r=reviewedReport(),reportPath=join(dir,'report.json');writeFileSync(reportPath,JSON.stringify(r));
  const cli=new URL('../dist/cli.js',import.meta.url).pathname,run=(...args)=>execFileSync(process.execPath,[cli,...args],{encoding:'utf8'});
  const file=join(dir,'feedback.json'),draft=join(dir,'entry.json'),updated=join(dir,'updated.json'),copy=join(dir,'copy.json');
  run('feedback-template',reportPath,'-o',file);run('feedback-template',reportPath,'--recommendation-id',r.recommendations[0].id,'-o',draft);
  const entry=JSON.parse(readFileSync(draft,'utf8'));entry.review.reason='Explicit local review';writeFileSync(draft,JSON.stringify(entry));
  run('feedback-add',reportPath,file,draft,'-o',updated);assert.match(run('feedback-validate',reportPath,updated),/Valid feedback/);run('feedback-export',reportPath,updated,'-o',copy);assert.deepEqual(JSON.parse(readFileSync(copy,'utf8')),JSON.parse(readFileSync(updated,'utf8')));
  const samples=join(dir,'samples.json'),summary=join(dir,'summary.json');writeFileSync(samples,JSON.stringify({samples:[{report:r,feedback:JSON.parse(readFileSync(copy,'utf8'))}]}));run('feedback-analyze',samples,'-o',summary);assert.equal(JSON.parse(readFileSync(summary,'utf8')).reviewed_recommendations,1);
});
