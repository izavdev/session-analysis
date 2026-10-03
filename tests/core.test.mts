import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {NormalizedEvent, NormalizedSession, Usage} from '../src/types.ts';
import {analyze, evidencePacket, mergeInterpretation} from '../dist/core.js';
import {validateReport} from '../dist/validation.js';

const fields = ['input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','reasoning_tokens','total_tokens'] as const;
function session(id='s1', events: NormalizedEvent[]=[], usage: Partial<Usage>={}, agent: NormalizedSession['agent']='codex', fingerprint='abc'): NormalizedSession {
  return {id, agent, agent_version:null, source:{format:'synthetic', fingerprint}, started_at:null, ended_at:null, parent_id:null, relationship:null,
    events, usage:Object.fromEntries(fields.map(k=>[k,usage[k]??null])) as unknown as Usage,
    coverage:{usage:Object.keys(usage).length?'partial':'unavailable', tools:'observed', limitations:[]}};
}
function event(id:string,type:NormalizedEvent['type']='user',text='', extra:Partial<NormalizedEvent>={}):NormalizedEvent {
  return {id,type,text,timestamp:null,source_ref:'line:'+id,...extra};
}
test('unknown usage remains null and known zero remains zero; duplicate identities are excluded',()=>{
  const a=session(); const zero=session('z',[],Object.fromEntries(fields.map(k=>[k,0])));
  const r=analyze([a,structuredClone(a),session('s1',[],{total_tokens:99},'codex','conflict'),zero]);
  assert.deepEqual(r.scope.session_ids,['codex:s1','codex:z']);
  assert.deepEqual(r.scope.excluded_sessions.map(x=>x.reason),['duplicate','conflicting_identity']);
  assert.equal(r.summary.total_tokens,0); assert.equal(r.coverage.usage,'partial'); assert.equal(r.report.status,'partial');
  assert.equal(analyze([a]).summary.total_tokens,null);
  assert.equal(r.report.id,analyze([a,structuredClone(a),session('s1',[],{total_tokens:99},'codex','conflict'),zero]).report.id);
  assert.equal(r.privacy.safe_to_share,null);
  validateReport(r);
});

test('linked errors, large results, repeated calls and skill loads are evidenced without transcript leakage',()=>{
  const secret='/Users/alice/private/token.txt https://site.test/key?q=secret me@example.com sk-'+'a'.repeat(40);
  const events=[event('1','tool_call','',{tool_name:'read',call_id:'a',arguments:{path:secret},source_ref:secret}),
    event('2','tool_call','',{tool_name:'read',call_id:'b',arguments:{path:secret}}),
    event('3','tool_result',secret+'x'.repeat(12000),{call_id:'a',is_error:true}),
    event('4','tool_result','orphan',{call_id:'unknown',is_error:true}),
    event('5','skill','',{skill_name:'review',skill_state:'loaded'}),event('6','skill','',{skill_name:'review',skill_state:'loaded'})];
  const r=analyze([session('s1',events)]);
  assert.deepEqual(new Set(r.findings.map(f=>f.rule_id)),new Set(['failed_tool_call','large_tool_output','repeated_tool_call','repeated_skill_load']));
  assert.deepEqual(r.recommendations,[]);
  assert.ok(r.findings.every(f=>f.recommendation_ids.length===0));
  assert.equal(r.metrics.tools[0]?.errors,1); assert.equal(r.metrics.tools[0]?.output_chars,events[2]!.text.length);
  assert.equal(r.sessions[0]?.metrics.skill_load_count,2);
  assert.equal(r.report.status,'partial'); assert.equal(r.evidence.every(e=>e.excerpt===null),true);
  assert.equal(JSON.stringify(r).includes(secret),false);
  const opt=analyze([session('s1',events)],true);
  assert.equal(opt.evidence.some(e=>e.excerpt!==null),true);
  assert.equal(opt.evidence.every(e=>e.excerpt===null||e.excerpt.length<=240),true);
  for(const value of ['/Users/alice','q=secret','me@example.com','sk-'+'a'.repeat(40)]) assert.equal(JSON.stringify(opt).includes(value),false);
  validateReport(opt);
});

test('large source read stays evidenced without automatic recommendations or cost claims',()=>{
  const r=analyze([session('s',[event('call','tool_call','',{tool_name:'read_file',call_id:'c',arguments:{path:'src/core.ts'}}),event('result','tool_result','x'.repeat(10000),{call_id:'c',is_error:false})])]);
  const observation=r.findings.find(f=>f.rule_id==='large_tool_output')?.observation;
  assert.equal(observation,'This tool result contains 10000 characters. Its token and cost impact were not measured separately.');
  assert.doesNotMatch(observation!,/billed tokens|free/i);
  assert.deepEqual(r.recommendations,[]);
  assert.equal(r.evidence.length,2);
  validateReport(r);
});

test('recurring requests are deferred, inferred candidates with evidence in both sessions',()=>{
  const r=analyze([session('a',[event('u','user','Please REVIEW the PR!')]),session('b',[event('v','user','please review the pr')])]);
  assert.equal(r.skill_candidates.length,1); assert.equal(r.skill_candidates[0]?.recommendation,'defer');
  assert.deepEqual(r.skill_candidates[0]?.session_ids,['codex:a','codex:b']);
  assert.equal(r.findings[0]?.claim_type,'inferred'); assert.equal(JSON.stringify(r).includes('review the pr'),false);
  assert.deepEqual(r.recommendations,[]);
  assert.deepEqual(r.findings[0]?.recommendation_ids,[]);
  validateReport(r);
});

test('session controls are retained in the timeline but never become recurring workflow candidates',()=>{
  for(const text of ['/clear','/compact preserve the current task','<command-name>/clear</command-name>\n <command-message>clear</command-message>\n <command-args></command-args>',
    '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>preserve task</command-args>']) {
    const r=analyze([session('a',[event('u','user',text)]),session('b',[event('u','user',text)])]);
    assert.deepEqual(r.skill_candidates,[],text);
    assert.equal(r.findings.some(f=>f.rule_id==='recurring_user_request'),false,text);
    assert.equal(r.sessions.every(s=>s.timeline.length===1),true);
    validateReport(r);
  }
  for(const text of ['/review this pull request','Please document how /clear works','<command-name>/review</command-name>\n<command-message>review</command-message>\n<command-args>this pull request</command-args>']) {
    const r=analyze([session('a',[event('u','user',text)]),session('b',[event('u','user',text)])]);
    assert.equal(r.skill_candidates.length,1,text);
  }
});
test('contiguous identical explicit failures form one review-only sequence with recovery evidence',()=>{
  const secret='/Users/alice/private/source.ts';
  const events=[
    event('c1','tool_call','',{tool_name:'read',call_id:'1',arguments:{path:secret,offset:1}}),
    event('r1','tool_result','File missing: '+secret,{call_id:'1',is_error:true}),
    event('a','assistant','Retrying'),event('u','usage'),
    event('c2','tool_call','',{tool_name:'read',call_id:'2',arguments:{offset:1,path:secret}}),
    event('r2','tool_result','File missing: '+secret,{call_id:'2',is_error:true}),
    event('c3','tool_call','',{tool_name:'read',call_id:'3',arguments:{path:secret,offset:1}}),
    event('r3','tool_result','Source found',{call_id:'3',is_error:false})];
  const r=analyze([session('s',events)]);
  assert.deepEqual(r.findings.map(f=>f.rule_id),['repeated_failed_attempt']);
  const f=r.findings[0]!;
  assert.equal(f.interpretation,'Later explicit non-error result observed; task outcome remains unknown.');
  assert.deepEqual(f.recommendation_ids,[]);assert.deepEqual(r.recommendations,[]);
  const evidence=r.evidence.filter(e=>f.evidence_ids.includes(e.id));
  assert.deepEqual(evidence.map(e=>e.event_id),['c1','r1','c2','r2','c3','r3'].map(id=>'codex:s:'+id));
  assert.equal(r.metrics.tools[0]?.errors,2);assert.equal(r.sessions[0]?.metrics.tool_error_count,2);
  assert.equal(JSON.stringify(r).includes(secret),false);
  assert.equal(r.evidence.every(e=>e.excerpt===null),true);
  const opt=analyze([session('s',events)],true);
  assert.equal(JSON.stringify(opt).includes(secret),false);
  validateReport(r);validateReport(opt);
});

function attempt(id:string,command='read source.ts',text='File missing',is_error?:boolean|null):NormalizedEvent[] {
  return [event('c'+id,'tool_call','',{tool_name:'terminal',call_id:id,arguments:{command}}),
    event('r'+id,'tool_result',text,{call_id:id,is_error:arguments.length<4?true:is_error})];
}

test('single failed call followed by same-call explicit non-error result retains recovery evidence as Activity',()=>{
  const r=analyze([session('s',[...attempt('1'),event('a','assistant'),...attempt('2','read source.ts','Read complete',false)])]);
  assert.deepEqual(r.findings.map(f=>f.rule_id),['failed_tool_call']);
  const f=r.findings[0]!;
  assert.equal(f.interpretation,'Later explicit non-error result observed; task outcome remains unknown.');
  assert.deepEqual(r.evidence.filter(e=>f.evidence_ids.includes(e.id)).map(e=>e.event_id),['c1','r1','c2','r2'].map(id=>'codex:s:'+id));
  assert.deepEqual(r.recommendations,[]);assert.equal(r.sessions[0]?.metrics.tool_error_count,1);validateReport(r);
});

test('single explicit error with empty text still retains exact retry recovery evidence',()=>{
  const r=analyze([session('s',[...attempt('1','read source.ts',''),...attempt('2','read source.ts','Read complete',false)])]);
  assert.deepEqual(r.findings.map(f=>f.rule_id),['failed_tool_call']);
  assert.equal(r.findings[0]?.evidence_ids.length,4);
  assert.equal(r.findings[0]?.interpretation,'Later explicit non-error result observed; task outcome remains unknown.');
  validateReport(r);
});

test('single failure does not claim recovery from an unknown result or across an intervening action',()=>{
  for(const events of [
    ...[null,undefined].map(is_error=>[...attempt('1'),...attempt('2','read source.ts','Read complete',is_error)]),
    ...(['user','compression','skill'] as const).map(type=>[...attempt('1'),event('boundary',type),...attempt('2','read source.ts','Read complete',false)]),
    [...attempt('1'),...attempt('action','create source.ts','Created',false),...attempt('2','read source.ts','Read complete',false)],
  ]) {
    const r=analyze([session('s',events)]),f=r.findings.find(f=>f.rule_id==='failed_tool_call')!;
    assert.equal(f.evidence_ids.length,2);
    assert.equal(f.interpretation,'An error does not establish task failure or avoidable work.');
    assert.equal(r.sessions[0]?.metrics.tool_error_count,1);validateReport(r);
  }
});

test('changed command, tool, error text or intervening action cannot establish repeated failure',()=>{
  const variants:NormalizedEvent[][]=[
    [...attempt('1'),...attempt('2','read other.ts')],
    [...attempt('1'),...attempt('2').map(e=>e.type==='tool_call'?{...e,tool_name:'read_file'}:e)],
    [...attempt('1'),...attempt('2','read source.ts','Permission denied')],
    [...attempt('1'),...attempt('2','read source.ts','File missing ')],
    ...(['user','compression','skill'] as const).map(type=>[...attempt('1'),event('boundary',type),...attempt('2')]),
    [...attempt('1'),...attempt('action','create source.ts','Created',false),...attempt('2')],
    [...attempt('1','read source.ts',''),...attempt('2','read source.ts','')],
    [...attempt('1','read source.ts','  '),...attempt('2','read source.ts','  ')],
    [...attempt('1'),...attempt('2','read source.ts','File missing',null)],
    [...attempt('1'),...attempt('2','read source.ts','File missing',undefined)],
  ];
  for(const events of variants) {
    const r=analyze([session('s',events)]);
    assert.equal(r.findings.some(f=>f.rule_id==='repeated_failed_attempt'),false,JSON.stringify(events));
    assert.deepEqual(r.recommendations,[]);validateReport(r);
  }
});

test('unknown results do not claim explicit recovery for an established failure episode',()=>{
  for(const is_error of [null,undefined]) {
    const events=[...attempt('1'),...attempt('2'),...attempt('3','read source.ts','Looks successful',is_error)];
    const r=analyze([session('s',events)]),f=r.findings.find(f=>f.rule_id==='repeated_failed_attempt')!;
    assert.ok(f);
    assert.equal(f.interpretation,'No later explicit non-error result observed; task outcome remains unknown.');
    assert.equal(f.evidence_ids.length,4);
    assert.equal(r.sessions[0]?.metrics.tool_error_count,2);
    assert.deepEqual(r.recommendations,[]);validateReport(r);
  }
});

test('separate retry episodes stay separate and ambiguous parallel results do not qualify',()=>{
  const r=analyze([session('s',[...attempt('1'),...attempt('2'),event('boundary','user'),...attempt('3'),...attempt('4')])]);
  assert.deepEqual(r.findings.map(f=>f.rule_id),['repeated_failed_attempt','repeated_failed_attempt']);
  assert.equal(r.metrics.tools[0]?.errors,4);validateReport(r);
  const a=attempt('1'),b=attempt('2');
  for(const events of [[a[0]!,b[0]!,a[1]!,b[1]!],[...a,...b,event('extra','tool_result','Different',{call_id:'2',is_error:false})],
    [...a,...attempt('1')],[...a,event('orphan','tool_result','File missing',{call_id:'missing',is_error:true}),...b]]) {
    const report=analyze([session('s',events)]);
    assert.equal(report.findings.some(f=>f.rule_id==='repeated_failed_attempt'),false);validateReport(report);
  }
});

test('model runs, limitations, and partial known subtotals retain provenance',()=>{
  const s=session('m',[event('a','assistant','',{model:'A',provider:'P'}),event('b','assistant','',{model:'A',provider:'P'}),event('c','assistant','',{model:'B',provider:'Q'})],{input_tokens:5});
  s.coverage={usage:'partial',tools:'unavailable',limitations:['Native usage incomplete at /Users/alice/private/log.jsonl']};
  const r=analyze([s]);
  assert.deepEqual(r.sessions[0]?.model_runs,[{model:'A',provider:'P'},{model:'B',provider:'Q'}]);
  assert.equal(r.summary.input_tokens,5);assert.equal(r.summary.total_tokens,null);
  assert.equal(r.report.status,'partial');assert.ok(r.coverage.limitations.some(x=>x.includes('Native usage incomplete')));
  assert.ok(!JSON.stringify(r).includes('/Users/alice'));validateReport(r);
});

test('provider-only events do not create phantom model switches',()=>{
  const events=[event('u1','user','',{provider:'anthropic'}),event('a1','assistant','',{model:'A',provider:'anthropic'}),
    event('u2','user','',{provider:'anthropic'}),event('a2','assistant','',{model:'A',provider:'anthropic'}),
    event('a3','assistant','',{model:'B',provider:'anthropic'}),event('u3','user','',{provider:'anthropic'}),
    event('a4','assistant','',{model:'A',provider:'anthropic'})];
  assert.deepEqual(analyze([session('s',events)]).sessions[0]?.model_runs,[
    {model:'A',provider:'anthropic'},{model:'B',provider:'anthropic'},{model:'A',provider:'anthropic'}]);
  assert.deepEqual(analyze([session('unknown',[event('u','user','',{provider:'anthropic'})])]).sessions[0]?.model_runs,[]);
});

test('reported coverage is downgraded when reported session total is missing',()=>{
  const s=session('p',[],{input_tokens:5});s.coverage.usage='reported';
  const r=analyze([s]);assert.equal(r.coverage.usage,'partial');assert.equal(r.report.status,'partial');validateReport(r);
});

test('ignored source records keep reported usage but make overall coverage partial',()=>{
  const s=session('p',[],{input_tokens:5,output_tokens:2,total_tokens:7});
  s.coverage.usage='reported';s.coverage.limitations=['Ignored 3 Claude attachment records; first at line:1.'];
  const r=analyze([s]);
  assert.equal(r.coverage.usage,'reported');
  assert.equal(r.report.status,'partial');
  assert.match(r.coverage.limitations.join(' '),/Ignored 3 Claude attachment records/);
  validateReport(r);
});

test('packet fits serialized character budget and never includes dangling findings',()=>{
  const events=Array.from({length:20},(_,i)=>event(String(i),'tool_call','',{tool_name:'read',call_id:String(i),arguments:{x:i}}));
  const r=analyze([session('s1',events)]);
  for(const limit of [1200,12000]) {
    const packet=evidencePacket(r,limit);
    assert.ok(JSON.stringify(packet).length<=limit); assert.equal(typeof packet.truncated,'boolean');
    const ids=new Set(packet.evidence.map(e=>e.id));
    for(const f of packet.findings) assert.ok(f.evidence_ids.every(id=>ids.has(id)));
  }
  assert.throws(()=>evidencePacket(r,79)); assert.throws(()=>evidencePacket(r,100.5));
});

test('manual merge accepts only evidenced inferred additions without mutating original',()=>{
  const r=analyze([session('s1',[event('1','tool_call','',{tool_name:'read',call_id:'a',arguments:{}}),event('2','tool_call','',{tool_name:'read',call_id:'b',arguments:{}})])]);
  const f={id:'finding:manual',category:'workflow_efficiency',rule_id:'manual_review',title:'Review workflow',severity:'low',claim_type:'inferred',confidence:'low',session_ids:['codex:s1'],evidence_ids:[r.evidence[0]!.id],observation:'Same call pattern',interpretation:'Potential reuse',recommendation_ids:['recommendation:manual']};
  const recommendation={id:'recommendation:manual',title:'Investigate',action:'Review before reuse',kind:'investigate',priority:'low',finding_ids:['finding:manual'],overlap_group:null};
  const merged=mergeInterpretation(r,{findings:[f],recommendations:[recommendation]});
  assert.equal(merged.summary.finding_count,r.summary.finding_count+1); assert.equal(merged.analysis_usage.mode,'assisted'); assert.equal(r.analysis_usage.mode,'metrics_only');
  validateReport(merged);
  for(const bad of [{summary:{total_tokens:999}},{evidence:[{id:'invented'}]},{findings:[{...f,id:'finding:fake',evidence_ids:['invented']}]},{findings:[{...f,id:'finding:fake',claim_type:'observed'}]}]) assert.throws(()=>mergeInterpretation(r,bad));
});
test('structured JSON arguments compare canonically while shell strings remain distinct',()=>{
  const r=analyze([session('json',[
    event('a','tool_call','',{tool_name:'read_file',arguments:'{"path":"a","offset":1}'}),
    event('b','tool_call','',{tool_name:'read_file',arguments:'{ "offset": 1, "path": "a" }'}),
    event('c','tool_call','',{tool_name:'read_file',arguments:'{"path":"b","offset":1}'}),
    event('d','tool_call','',{tool_name:'shell',arguments:'echo a'}),
    event('e','tool_call','',{tool_name:'shell',arguments:'echo  a'}),
  ])]);
  assert.equal(r.findings.filter(f=>f.rule_id==='repeated_tool_call').length,1);
  assert.equal(r.findings[0].evidence_ids.length,2);
});
