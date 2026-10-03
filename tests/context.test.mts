import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cases} from '../evaluations/cases.mjs';
import {analyze,evidencePacket,selectContext,mergeInterpretation} from '../dist/core.js';
test('selected ordinary context is bounded, citeable, opt-in and leaves measured fields intact',()=>{
  const s=cases.find(c=>c.id==='ordinary-correction').sessions[0];const report=analyze([s]);
  const context=selectContext(report,s,['codex:ordinary-correction:correction'],true);
  assert.deepEqual(context.metrics,report.metrics);assert.deepEqual(context.summary,report.summary);
  assert.equal(report.privacy.excerpts_included,false);assert.equal(context.privacy.excerpts_included,true);
  const e=context.evidence.find(e=>e.event_id.endsWith(':correction'));assert.match(e.excerpt,/not JSON/);
  const packet=evidencePacket(context);assert.ok(packet.evidence.some(x=>x.id===e.id));
  const finding={id:'format-review',category:'workflow_efficiency',rule_id:'format-review',title:'Format correction',severity:'low',claim_type:'inferred',confidence:'low',session_ids:[e.session_id],evidence_ids:[e.id],observation:'User corrected the format',interpretation:'Consider output-format validation',recommendation_ids:[]};
  assert.equal(mergeInterpretation(context,{findings:[finding]}).findings.length,1);
  const noText=selectContext(report,s,['codex:ordinary-correction:correction']);assert.ok(noText.evidence.every(e=>e.excerpt===null));
  assert.throws(()=>selectContext(report,{...s,id:'wrong'},['wrong']));
  assert.throws(()=>selectContext(report,{...s,events:s.events.slice(1)},['codex:ordinary-correction:correction']));
  assert.throws(()=>selectContext(report,s,['unknown']));
});
test('selected calls require unique result linkage and retain changed approach and verification',()=>{
  const s=cases.find(c=>c.id==='same-retries').sessions[0],r=analyze([s]);
  const selected=selectContext(r,s,['codex:same-retries:c3'],true);
  assert.ok(selected.evidence.some(e=>e.excerpt==='PASS'));
  assert.ok(selected.evidence.some(e=>e.event_id.endsWith(':request')));
  const ambiguous=structuredClone(s);ambiguous.events.push({...s.events[2],id:'extra'});
  assert.throws(()=>selectContext(analyze([ambiguous]),ambiguous,['codex:same-retries:c1']),/ambiguous/);
});
test('packets select complete bundles fairly and retain coverage with explicit omissions',()=>{
  const a=cases[0].sessions[0],b={...a,id:'other'};const r=analyze([a,b]);
  const all=evidencePacket(r,12000);assert.equal(all.findings.length,3);assert.deepEqual(all.coverage,r.coverage);
  const one=evidencePacket(r,12000,{session_ids:['codex:other'],finding_ids:r.findings.filter(f=>f.rule_id==='large_tool_output').map(f=>f.id)});assert.equal(one.findings.length,1);assert.deepEqual(one.findings[0].session_ids,['codex:other']);
  assert.throws(()=>evidencePacket(r,80),/scope/);assert.throws(()=>evidencePacket(r,12000,{finding_ids:['bad']}));
});
