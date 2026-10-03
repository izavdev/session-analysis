import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cases} from '../evaluations/cases.mjs';
import {analyze,selectContext,evidencePacket} from '../dist/core.js';
import {reviewOutcome} from '../dist/episodes.js';
function contextual(id){const s=cases.find(c=>c.id===id).sessions[0];return selectContext(analyze([s]),s,s.events.filter(e=>e.type==='user').map(e=>`${s.agent}:${s.id}:${e.id}`),true);}
test('changed strategy and candidate verification link into a reviewable episode without task success inference',()=>{
  const r=contextual('same-retries');assert.equal(r.episodes.length,1);const e=r.episodes[0];assert.equal(e.outcome.state,'unknown');assert.equal(e.action_evidence_ids.length,10);assert.equal(e.verification_evidence_ids.length,2);
  const packet=evidencePacket(r);assert.equal(packet.episodes.length,1);assert.ok(e.evidence_ids.every(id=>packet.evidence.some(x=>x.id===id)));
  const reviewed=reviewOutcome(r,{episode_id:e.id,state:'verified',criteria:'Selected generated source passes the supplied test; broader deployment unassessed.',evidence_ids:e.verification_evidence_ids,reviewer:'synthetic reviewer'});
  assert.equal(reviewed.episodes[0].outcome.basis,'reviewer_assessment');assert.equal(r.episodes[0].outcome.state,'unknown');
  assert.throws(()=>reviewOutcome(r,{episode_id:e.id,state:'verified',criteria:'Done',evidence_ids:[e.request_evidence_id],reviewer:'test'}));
});
test('ordinary corrections and claimed completion differ from new requests and compaction',()=>{
  const corrected=contextual('ordinary-correction');assert.equal(corrected.episodes.length,1);assert.equal(corrected.episodes[0].correction_evidence_ids.length,1);assert.equal(corrected.episodes[0].outcome.state,'unknown');
  const necessary=contextual('necessary-read');assert.equal(necessary.episodes[0].outcome.state,'claimed_complete');
  const s=structuredClone(cases.find(c=>c.id==='ordinary-task').sessions[0]);s.events.push({id:'boundary',type:'compression',text:'',timestamp:null,source_ref:'event:boundary'},{id:'new',type:'user',text:'Different task',timestamp:null,source_ref:'event:new'});
  const r=selectContext(analyze([s]),s,s.events.filter(e=>e.type==='user').map(e=>`${s.agent}:${s.id}:${e.id}`));assert.equal(r.episodes.length,2);assert.ok(r.evidence.every(e=>e.excerpt===null));
});
