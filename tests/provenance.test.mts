import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cases} from '../evaluations/cases.mjs';
import {analyze,selectContext,mergeInterpretation} from '../dist/core.js';
import {validateReport} from '../dist/validation.js';
import {BUILD} from '../dist/build-info.js';
test('release and build provenance match actual analyzer and preserve stable measured identity',()=>{
  const s=cases[0].sessions[0],a=analyze([s]),b=analyze([s]);
  assert.equal(a.report.analyzer_version,readFileSync(new URL('../VERSION',import.meta.url),'utf8').trim());
  assert.equal(a.report.analyzer_version,JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version);
  assert.equal(a.provenance.analyzer.build_sha256,BUILD.build_sha256);assert.match(BUILD.build_sha256,/^[a-f0-9]{64}$/);
  assert.equal(a.report.id,b.report.id);assert.deepEqual(a.findings,b.findings);assert.deepEqual(a.metrics,b.metrics);
  const changed=structuredClone(s);changed.events[0].text='Different request';assert.throws(()=>selectContext(a,changed,[`codex:${s.id}:request`]),/fingerprint/);
});
test('legacy reports validate; assisted provenance keeps unknowns explicit',()=>{
  const old=JSON.parse(readFileSync(new URL('../evaluations/baseline/run.json',import.meta.url),'utf8')).cases[0].report;
  validateReport(old);const merged=mergeInterpretation(old,{});validateReport(merged);
  assert.equal(merged.provenance.analyzer.version,'0.1.0');assert.equal(merged.provenance.interpretations[0].model,null);
  assert.throws(()=>mergeInterpretation(old,{}, {model:'M',instruction_sha256:null,packet_sha256:null,max_chars:12000,context_event_ids:['fake'],model_tokens:null}));
});
