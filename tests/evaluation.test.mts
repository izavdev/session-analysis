import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cases} from '../evaluations/cases.mjs';
import {review} from '../scripts/evaluate.mjs';
import {analyze,evidencePacket} from '../dist/core.js';
const baseline=JSON.parse(readFileSync(new URL('../evaluations/baseline/run.json',import.meta.url),'utf8'));
const outputs=JSON.parse(readFileSync(new URL('../evaluations/baseline/outputs.json',import.meta.url),'utf8'));
test('recorded model baseline has matching fingerprints, reviews and separate criteria',()=>{
  assert.ok(cases.length>=12);assert.ok(cases.some(c=>c.split==='held_out'));assert.ok(cases.some(c=>c.rubric.opportunity));
  const result=review(baseline,outputs);assert.equal(result.reviewed,12);assert.deepEqual(result.unreviewed,[]);
  assert.equal(result.rows.filter(c=>c.reviews.some(r=>r.missed_opportunity)).length,2);
  const wrong=structuredClone(outputs);wrong.outputs[0].packet_sha256='wrong';assert.throws(()=>review(baseline,wrong));
  const duplicate=structuredClone(outputs);duplicate.outputs.push(duplicate.outputs[0]);assert.throws(()=>review(baseline,duplicate));
  const fabricated=structuredClone(outputs);fabricated.outputs[0].interpretation.findings=[{evidence_ids:['invented']}];assert.throws(()=>review(baseline,fabricated));
});
test('populated packet baseline exposes lost findings without dangling references',()=>{
  const s=structuredClone(cases[0].sessions[0]);
  s.events=Array.from({length:40},(_,i)=>[
    {id:`c${i}`,type:'tool_call',text:'',timestamp:null,source_ref:`event:c${i}`,tool_name:'read',call_id:String(i),arguments:{index:i}},
    {id:`r${i}`,type:'tool_result',text:'x'.repeat(11000),timestamp:null,source_ref:`event:r${i}`,call_id:String(i),is_error:false},
  ]).flat();
  const report=analyze([s]);assert.equal(report.findings.length,40);
  const packet=evidencePacket(report);assert.ok(JSON.stringify(packet).length<=12000);assert.ok(packet.truncated);
  const ids=new Set(packet.evidence.map(e=>e.id));for(const f of packet.findings) assert.ok(f.evidence_ids.every(id=>ids.has(id)));
  assert.ok(packet.findings.length>0);
});
