import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyze} from '../dist/core.js';
import {validateReport} from '../dist/validation.js';
import type {NormalizedSession, Report} from '../src/types.ts';

const usage={input_tokens:null,output_tokens:null,cache_read_tokens:null,cache_write_tokens:null,reasoning_tokens:null,total_tokens:null};
function report(): Report {
  const s:NormalizedSession={id:'x',agent:'codex',agent_version:null,source:{format:'synthetic',fingerprint:'x'},started_at:null,ended_at:null,parent_id:null,relationship:null,events:[
    {id:'a',type:'tool_call',timestamp:null,text:'',source_ref:'line:1',call_id:'1',tool_name:'read',arguments:{}},
    {id:'b',type:'tool_call',timestamp:null,text:'',source_ref:'line:2',call_id:'2',tool_name:'read',arguments:{}}],usage,coverage:{usage:'unavailable',tools:'observed',limitations:[]}};
  const r=analyze([s]);
  // Explicit synthetic recommendation: ordinary activity no longer produces one automatically.
  r.recommendations.push({id:'recommendation:fixture',title:'Synthetic intervention',action:'Synthetic action for reference validation',kind:'workflow',priority:'low',finding_ids:[r.findings[0]!.id],overlap_group:null});
  r.findings[0]!.recommendation_ids=['recommendation:fixture'];
  return r;
}
function invalid(change:(r:Report)=>void):void {const r=structuredClone(report());change(r);assert.throws(()=>validateReport(r));}

test('generated report matches schema root and validates',()=>{
  const r=report(); assert.equal(validateReport(r),undefined);
  const schema=JSON.parse(readFileSync(new URL('../schemas/report.schema.json',import.meta.url),'utf8'));
  assert.deepEqual(new Set(Object.keys(r)),new Set(schema.required)); assert.equal(schema.properties.schema_version.const,'1.0.0');
});

test('rejects unexpected fields, invalid timestamps, versions, enums, counts, and null contradictions',()=>{
  invalid(r=>{(r as any).invented={private:'text'};});
  invalid(r=>{r.schema_version='2.0.0' as any;});
  invalid(r=>{r.report.generated_at='2020-01-01T00:00:00';});
  invalid(r=>{r.report.generated_at='2026-02-31T00:00:00Z';});
  invalid(r=>{r.summary.tool_call_count=true as any;});
  invalid(r=>{r.summary.finding_count=999;});
  invalid(r=>{r.findings[0]!.category='invalid' as any;});
  invalid(r=>{(r.findings[0] as any).measured_savings=999;});
  invalid(r=>{r.coverage.usage='reported';});
  invalid(r=>{r.privacy.safe_to_share=true as any;});
  invalid(r=>{r.metrics.tools.push({name:'bad',calls:-1,errors:0,output_chars:0});});
});

test('all cross references and evidence ownership must resolve',()=>{
  invalid(r=>{r.findings[0]!.evidence_ids=['unknown'];});
  invalid(r=>{r.evidence[0]!.event_id='unknown';});
  invalid(r=>{r.recommendations[0]!.finding_ids=['unknown'];});
  invalid(r=>{r.scope.session_ids=['unknown'];});
  invalid(r=>{r.findings[0]!.evidence_ids=42 as any;});
  invalid(r=>{r.evidence[0]!.excerpt='private';});
  invalid(r=>{delete (r.findings[0] as any).id;});
  invalid(r=>{r.sessions[0]!.timeline[0]!.event_id=r.sessions[0]!.timeline[1]!.event_id;});
});

test('candidate evidence must belong to declared session',()=>{
  const a=report(); const s=structuredClone(a.sessions[0]!);
  s.id='codex:y'; s.timeline=s.timeline.map(e=>({...e,event_id:e.event_id.replace('codex:x','codex:y')}));
  a.sessions.push(s);a.scope.session_ids.push(s.id);a.summary.session_count=2;a.summary.tool_call_count+=s.metrics.tool_call_count;
  a.skill_candidates.push({id:'candidate:test',title:'t',trigger:'t',session_ids:[s.id],evidence_ids:[a.evidence[0]!.id],recommendation:'defer',rationale:'t',acceptance_tests:[]});
  assert.throws(()=>validateReport(a));
});
