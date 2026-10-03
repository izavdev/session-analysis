import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { validateReport, parseReport, selectScope, formatNumber, renderReport, bootstrap, inspectClaudeLog, inspectCodexLog, detectPlatform, MAX_FILE_BYTES } from '../src/web/app.ts';
import type { Report } from '../src/types.ts';

const html = readFileSync(fileURLToPath(new URL('../web/index.html', import.meta.url)), 'utf8');
const demoLog = readFileSync(new URL('../web/examples/codex-pages-session.jsonl', import.meta.url), 'utf8');
const demoReport = parseReport(readFileSync(new URL('../web/examples/codex-pages-report.json', import.meta.url), 'utf8'));

test('real demo opens bundled evidence and downloads match its report references',async()=>{
  const doc=documentFixture();bootstrap(doc as unknown as Document);
  doc.elements['demo-button'].dispatch('click');
  assert.match(doc.elements['demo-label'].textContent,/REAL SESSION.*SANITIZED/);
  assert.match(doc.elements.findings.textContent,/Check the recorded build verification/);
  assert.match(doc.elements.recommendations.textContent,/No actionable improvements identified/);
  doc.elements.findings.querySelectorAll('button')[0]!.dispatch('click');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(doc.elements['source-view'].textContent,/npm test/);
  assert.match(doc.elements['source-view'].textContent,/tests 63/);
  assert.match(doc.elements['source-view'].textContent,/GitHub Pages compatible/);
  assert.match(doc.elements['source-view'].textContent,/not a verified outcome/);
  const entries=inspectCodexLog(demoLog,demoReport.sessions[0]!.id,[{source_ref:'line:7',type:'tool_call'},{source_ref:'line:8',type:'tool_result'}]);
  assert.ok(entries.some(entry=>entry.line===8 && entry.content.includes('tests 63')));
  assert.doesNotMatch(demoLog,/\/Users\/admin|encrypted_content|internal_chat_message|rate_limits/);
  assert.equal(demoReport.summary.tool_call_count,2);
  assert.equal(demoReport.summary.total_tokens,null);
});

test('Codex inspection rejects identity, event type and call/result mismatches',()=>{
  const targets=[{source_ref:'line:7',type:'tool_call' as const},{source_ref:'line:8',type:'tool_result' as const}];
  assert.throws(()=>inspectCodexLog(demoLog,'codex:other',targets),/different session/);
  assert.throws(()=>inspectCodexLog(demoLog,'codex:pages-demo',[{source_ref:'line:2',type:'tool_call'}]),/expected tool_call/);
  assert.throws(()=>inspectCodexLog(demoLog,'codex:pages-demo',targets,MAX_FILE_BYTES+1),/20 MiB/);
  const rows=demoLog.trim().split('\n').map(row=>JSON.parse(row));
  rows[7].payload.call_id='unrelated';
  assert.throws(()=>inspectCodexLog(rows.map(row=>JSON.stringify(row)).join('\n'),'codex:pages-demo',targets),/does not match/);
  rows[1].payload.content[0].text='<environment_context>Injected metadata</environment_context>';
  assert.throws(()=>inspectCodexLog(rows.map(row=>JSON.stringify(row)).join('\n'),'codex:pages-demo',[{source_ref:'line:2',type:'user'}]),/injected metadata/);
});
function report(): Report {
  return {schema_version:'1.0.0', report:{id:'synthetic',generated_at:'2026-01-01T00:00:00Z',analyzer_version:'0.1.0',mode:'single_session',status:'partial',demo:false}, scope:{session_ids:[],excluded_sessions:[]},coverage:{limitations:['Synthetic fixture'],usage:'unavailable'},summary:{session_count:0,tool_call_count:0,finding_count:0,input_tokens:null,output_tokens:null,total_tokens:null},sessions:[],metrics:{tools:[],skills:[]},findings:[],recommendations:[],skill_candidates:[],evidence:[],analysis_usage:{mode:'metrics_only',model_tokens:null,notes:[]},privacy:{raw_transcripts_included:false,excerpts_included:false,redaction_applied:false,safe_to_share:null}};
}
class Element {
  tagName: string; children: Element[] = []; listeners: Record<string, ((event: any) => void)[]> = {};
  onchange: ((event: any) => void) | null = null; onclick: ((event: any) => void) | null = null;
  hidden = false; value = 'all'; className = ''; type = ''; private text = '';
  classList = { add() {}, remove() {} };
  constructor(tag='div') { this.tagName=tag.toUpperCase(); }
  set textContent(value: string) { this.text=String(value); this.children=[]; }
  get textContent(): string { return this.text + this.children.map(c=>c.textContent).join(''); }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.children=[]; this.text=''; this.append(...children); }
  addEventListener(name: string, fn: (event: any)=>void) { (this.listeners[name] ??= []).push(fn); }
  setAttribute(name: string, value: string) { if (name === 'type') this.type=value; }
  dispatchEvent(event: Event) { this.dispatch(event.type); return true; }
  dispatch(name: string, event: object = {}) { const e={preventDefault(){},...event};for (const fn of this.listeners[name] ?? []) fn(e);this[`on${name}` as 'onchange'|'onclick']?.(e); }
  querySelectorAll(tag: string): Element[] { return this.children.flatMap(c=>[...(c.tagName===tag.toUpperCase()?[c]:[]),...c.querySelectorAll(tag)]); }
}
function documentFixture() {
  const ids=['platform-select','session-path-guide','source-help','session-folder','import-status','workspace-files','workspace-list','workspace-count','workspace-clear','embedded-report','report-file','drop-zone','demo-button','clear-button','import-error','empty-state','report-view','report-label','demo-label','privacy-banner','coverage-banner','coverage-details','summary','session-count','agent-filter','sessions-body','no-sessions','inspector','finding-count','findings','activity','activity-count','suggestion-count','source-inspector','source-status','source-upload','source-file','source-view','source-close','recommendations','tools','skills','candidates','analysis-notes'];
  const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
  return {elements,getElementById:(id:string)=>elements[id] ?? null,createElement:(tag:string)=>new Element(tag),createTextNode:(text:string)=>{const e=new Element('text');e.textContent=text;return e;}};
}
function populated(): Report {
  const r=report(); const id='hermes:one';
  r.sessions=[{id,agent:'hermes',agent_version:null,started_at:null,ended_at:null,parent_id:null,relationship:null,usage:{input_tokens:100,output_tokens:null,cache_read_tokens:null,cache_write_tokens:null,reasoning_tokens:null,total_tokens:null},coverage:{usage:'partial',tools:'observed',limitations:['Unknown tokens']},metrics:{tool_call_count:2,tool_error_count:1,skill_load_count:1,event_count:1},model_runs:[],timeline:[{event_id:'ev',type:'tool_call',timestamp:null,tool_name:'shell',source_ref:'line:1'}]},{id:'codex:two',agent:'codex',agent_version:null,started_at:null,ended_at:null,parent_id:null,relationship:null,usage:{input_tokens:null,output_tokens:null,cache_read_tokens:null,cache_write_tokens:null,reasoning_tokens:null,total_tokens:null},coverage:{usage:'unavailable',tools:'observed',limitations:[]},metrics:{tool_call_count:0,tool_error_count:0,skill_load_count:0,event_count:0},model_runs:[],timeline:[]}];
  r.findings=[{id:'f1',category:'tool_efficiency',rule_id:'r1',title:'<img src=x onerror=alert(1)>',severity:'low',claim_type:'observed',confidence:'medium',session_ids:[id],evidence_ids:['e1'],observation:'Calls repeated',interpretation:'Investigate',recommendation_ids:['rec1']}];
  r.evidence=[{id:'e1',session_id:id,event_id:'ev',source_ref:'line:1',description:'Observed',excerpt:'<script>alert(1)</script>'}];
  r.recommendations=[{id:'rec1',title:'Review calls',action:'Inspect source',kind:'investigate',priority:'low',finding_ids:['f1'],overlap_group:null}];
  r.skill_candidates=[{id:'c1',title:'Reusable work',trigger:'Repeat',session_ids:[id],evidence_ids:['e1'],recommendation:'defer',rationale:'Needs validation',acceptance_tests:['Review']}];
  r.metrics.tools=[{name:'shell',calls:2,errors:1,output_chars:900}];
  return r;
}

test('offline shell and public API validate and safely import reports',()=>{
  assert.match(html,/<script defer src="app\.js"><\/script>/);
  assert.match(html,/<script id="embedded-report" type="application\/json"><\/script>/);
  assert.deepEqual(validateReport(report()),[]);
  assert.ok(validateReport({...report(),privacy:null}).length);
  assert.deepEqual(parseReport(JSON.stringify(report())),report());
  assert.throws(()=>parseReport('{'),/Invalid JSON/);
  assert.throws(()=>parseReport('{}',MAX_FILE_BYTES+1),/20 MiB/);
  assert.equal(formatNumber(null),'Unavailable');
  assert.equal(formatNumber(0),'0');
});
test('DOM displays evidence as text, inspect timeline, preserve unknown totals and privacy',()=>{
  const doc=documentFixture(); const r=populated(); renderReport(r,doc as unknown as Document);
  assert.equal(doc.elements['report-view'].hidden,false);
  assert.match(doc.elements.summary.textContent,/Unavailable/);
  assert.match(doc.elements['privacy-banner'].textContent,/not safe to share/i);
  assert.equal(doc.elements['sessions-body'].querySelectorAll('tr').length,2);
  doc.elements['sessions-body'].querySelectorAll('button')[0].dispatch('click');
  assert.match(doc.elements.inspector.textContent,/line:1/);
  assert.match(doc.elements.inspector.textContent,/Cache read/);
  assert.match(doc.elements.findings.textContent,/<img src=x/);
  assert.match(doc.elements.findings.textContent,/<script>alert/);
  assert.equal(doc.elements.findings.querySelectorAll('script').length,0);
  assert.equal(doc.elements.findings.querySelectorAll('img').length,0);
});
test('ordinary activity never becomes advice, including legacy reports with automatic recommendations',()=>{
  const doc=documentFixture(),r=populated();
  r.findings[0]!.rule_id='large_tool_output';r.findings[0]!.title='Large tool output';
  renderReport(r,doc as unknown as Document);
  assert.equal(doc.elements.findings.querySelectorAll('article').length,0);
  assert.equal(doc.elements.recommendations.querySelectorAll('article').length,0);
  assert.match(doc.elements.recommendations.textContent,/No actionable improvements identified/);
  assert.match(doc.elements.activity.textContent,/Large tool output/);
  assert.match(doc.elements.activity.textContent,/not an improvement recommendation/i);
});
test('investigation is review-only while specific evidenced interventions appear as suggestions',()=>{
  const doc=documentFixture(),r=populated();
  renderReport(r,doc as unknown as Document);
  assert.equal(doc.elements.recommendations.querySelectorAll('article').length,0);
  assert.match(doc.elements.findings.textContent,/Inspect source/);
  r.recommendations[0]!.kind='workflow';r.recommendations[0]!.action='Search for the target symbol before reading unrelated modules.';
  renderReport(r,doc as unknown as Document);
  assert.equal(doc.elements.recommendations.querySelectorAll('article').length,1);
  assert.match(doc.elements.recommendations.textContent,/Search for the target symbol/);
  assert.match(doc.elements.recommendations.textContent,/Calls repeated/);
});
test('source inspector opens the exact Claude call and result from selected local JSONL without embedding them in the report',async()=>{
  const doc=documentFixture(),r=populated(),id='claude_code:fa15da66-27bd-4fe5-97ba-874125ca79cf';
  r.sessions[0]!.id=id;r.sessions[0]!.agent='claude_code';
  r.sessions[0]!.timeline=[{event_id:'call',type:'tool_call',timestamp:null,tool_name:'Bash',source_ref:'line:48'},
    {event_id:'result',type:'tool_result',timestamp:null,tool_name:null,source_ref:'line:49'}];
  r.findings[0]!.session_ids=[id];r.findings[0]!.evidence_ids=['call-e','result-e'];
  r.evidence=[{id:'call-e',session_id:id,event_id:'call',source_ref:'line:48',description:'Tool call',excerpt:null},
    {id:'result-e',session_id:id,event_id:'result',source_ref:'line:49',description:'10,011 characters',excerpt:null}];
  const lines=Array(47).fill('{}');
  lines.push(JSON.stringify({sessionId:id.slice('claude_code:'.length),type:'assistant',message:{content:[{type:'tool_use',id:'t1',name:'Bash',input:{command:'printf secret'}}]}}));
  lines.push(JSON.stringify({sessionId:id.slice('claude_code:'.length),type:'user',message:{content:[{type:'tool_result',tool_use_id:'t1',content:'<script>not executed</script>'}]}}));
  renderReport(r,doc as unknown as Document);
  assert.doesNotMatch(doc.elements.findings.textContent,/printf secret|not executed/);
  const button=doc.elements.findings.querySelectorAll('button')[0]!;
  button.dispatch('click');
  assert.equal(doc.elements['source-inspector'].hidden,false);
  assert.match(doc.elements['source-status'].textContent,/line 48|line:48/);
  const input=doc.elements['source-file'];
  input.dispatch('change',{target:{files:[{size:lines.join('\n').length,text:async()=>lines.join('\n')}]}});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(doc.elements['source-view'].textContent,/Bash.*printf secret/s);
  assert.match(doc.elements['source-view'].textContent,/<script>not executed<\/script>/);
  assert.equal(doc.elements['source-view'].querySelectorAll('script').length,0);
  assert.match(doc.elements['source-view'].textContent,/line 48.*line 49/s);
});
test('local source inspection rejects a different Claude session and does not display its contents',()=>{
  const id='claude_code:fa15da66-27bd-4fe5-97ba-874125ca79cf';
  const wrong=JSON.stringify({sessionId:'different',type:'user',message:{content:[{type:'tool_result',content:'private output'}]}});
  assert.throws(()=>inspectClaudeLog(wrong,id,[{source_ref:'line:1',type:'tool_result'}]),/different session/i);
  assert.throws(()=>inspectClaudeLog(wrong,id,[{source_ref:'line:0',type:'tool_result'}]),/invalid source reference/i);
  assert.throws(()=>inspectClaudeLog(wrong,id,[{source_ref:'line:1',type:'tool_result'}],MAX_FILE_BYTES+1),/20 MiB/i);
});
test('closing or replacing the report discards a pending local source read',async()=>{
  for(const replace of [false,true]) {
    const doc=documentFixture(),r=populated(),id='claude_code:example';
    r.sessions[0]!.id=id;r.sessions[0]!.agent='claude_code';r.findings[0]!.session_ids=[id];
    r.evidence[0]!.session_id=id;
    renderReport(r,doc as unknown as Document);
    doc.elements.findings.querySelectorAll('button')[0]!.dispatch('click');
    let finish!:(text:string)=>void;
    doc.elements['source-file'].dispatch('change',{target:{files:[{size:100,text:()=>new Promise<string>(resolve=>{finish=resolve;})}]}});
    if(replace)renderReport(report(),doc as unknown as Document);
    else doc.elements['source-close'].dispatch('click');
    finish(JSON.stringify({sessionId:'example',type:'assistant',message:{content:[{type:'tool_use',name:'Bash',input:{command:'private command'}}]}}));
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(doc.elements['source-inspector'].hidden,true);
    assert.equal(doc.elements['source-view'].textContent,'');
  }
});
test('source drilldown explains reads and includes bounded surrounding intent and next action',()=>{
  const id='claude_code:example',row=(type:string,content:unknown,extra={})=>JSON.stringify({sessionId:'example',type,message:{content},...extra});
  const log=[row('user','Fix the board response'),row('user','Injected instruction',{isMeta:true}),
    row('assistant',[{type:'text',text:'I need to inspect the response mapping.'}]),
    row('assistant',[{type:'tool_use',id:'c',name:'Bash',input:{command:'cat backend/GetBoard.cs && sed -n 90,120p frontend/dispatch.ts'}}]),
    row('user',[{type:'tool_result',tool_use_id:'c',content:'source code'}]),
    row('assistant',[{type:'text',text:'The fields differ; I will update the mapper.'},{type:'tool_use',id:'edit',name:'Edit',input:{file_path:'backend/GetBoard.cs'}}]),
    row('user','Unrelated subsequent request')].join('\n');
  const entries=inspectClaudeLog(log,id,[{source_ref:'line:4',type:'tool_call'},{source_ref:'line:5',type:'tool_result'}]);
  const text=entries.map(e=>`${e.title}\n${e.content}`).join('\n');
  assert.match(text,/Read whole file: backend\/GetBoard.cs/);
  assert.match(text,/Read lines 90–120: frontend\/dispatch.ts/);
  assert.match(text,/Preceding user request.*Fix the board response/s);
  assert.match(text,/Preceding assistant context.*inspect the response mapping/s);
  assert.match(text,/Next recorded action.*update the mapper.*Edit/s);
  assert.doesNotMatch(text,/Injected instruction|Unrelated subsequent request/);
});
test('recurring request evidence can inspect its actual local user message without importing injected metadata',()=>{
  const row=(isMeta=false)=>JSON.stringify({sessionId:'example',type:'user',isMeta,message:{content:'Review this pull request'}});
  const entries=inspectClaudeLog(row(),'claude_code:example',[{source_ref:'line:1',type:'user'}]);
  assert.ok(entries.some(e=>e.title==='line 1 · user request' && e.content==='Review this pull request'));
  assert.throws(()=>inspectClaudeLog(row(true),'claude_code:example',[{source_ref:'line:1',type:'user'}]),/metadata/i);
});
test('read descriptions distinguish native ranges from shell flags and malformed syntax',()=>{
  const inspect=(name:string,input:unknown)=>inspectClaudeLog(JSON.stringify({sessionId:'example',type:'assistant',message:{content:[{type:'tool_use',name,input}]}}),'claude_code:example',[{source_ref:'line:1',type:'tool_call'}]).map(e=>e.content).join('\n');
  assert.match(inspect('Read',{file_path:'src/example.ts',offset:20,limit:30}),/Read up to 30 lines starting at line 20: src\/example.ts/);
  for(const command of ['cat --help','cat -','sed -n \'1,4p" src/file.ts'])assert.doesNotMatch(inspect('Bash',{command}),/Read whole file|Read lines/);
});
test('source drilldown does not guess complex shell intent or cross session boundaries',()=>{
  const row=(sessionId:string,type:string,content:unknown)=>JSON.stringify({sessionId,type,message:{content}});
  const log=[row('other','user','private request'),row('example','assistant',[{type:'tool_use',id:'c',name:'Bash',input:{command:'cat "$TARGET" | sh'}}]),
    row('example','user',[{type:'tool_result',tool_use_id:'c',content:'result'}]),row('other','assistant',[{type:'text',text:'private explanation'}])].join('\n');
  const entries=inspectClaudeLog(log,'claude_code:example',[{source_ref:'line:2',type:'tool_call'},{source_ref:'line:3',type:'tool_result'}]);
  const text=entries.map(e=>e.content).join('\n');
  assert.match(text,/cat "\$TARGET" \| sh/);
  assert.doesNotMatch(text,/Read whole file|private request|private explanation/);
  assert.match(text,/Preceding user request not found/);
});
test('inspector shows unique known models instead of alternating unavailable placeholders',()=>{
  const doc=documentFixture(),r=populated();
  r.sessions[0]!.model_runs=[{model:null,provider:'anthropic'},{model:'claude-opus-5-5',provider:'anthropic'},
    {model:null,provider:'anthropic'},{model:'claude-opus-5-5',provider:'anthropic'}];
  renderReport(r,doc as unknown as Document);
  const buttons=doc.elements['sessions-body'].querySelectorAll('button');
  buttons[0]!.dispatch('click');
  const inspector=doc.elements.inspector.textContent;
  assert.match(inspector,/Models observed/);
  assert.equal(inspector.split('anthropic \/ claude-opus-5-5').length-1,1);
  assert.doesNotMatch(inspector,/Model unavailable|Model runs/);
  buttons[1]!.dispatch('click');
  assert.match(doc.elements.inspector.textContent,/Model not reported/);
});
test('repeated diagnostics are grouped by meaning without discarding occurrences or evidence',()=>{
  const doc=documentFixture(),r=populated(),base=r.findings[0]!,rec={...r.recommendations[0]!,kind:'workflow' as const,overlap_group:'r1'};
  r.recommendations[0]=rec;
  r.findings.push(
    {...base,id:'f2',evidence_ids:['e2'],observation:'Second occurrence',recommendation_ids:['rec2']},
    {...base,id:'f3',evidence_ids:['e3'],observation:'Third occurrence',recommendation_ids:['rec3']},
    {...base,id:'f4',session_ids:['codex:two'],evidence_ids:['e4'],interpretation:'A different cause',observation:'Different observation',recommendation_ids:['rec4']}
  );
  r.evidence.push(...['e2','e3','e4'].map(id=>({id,session_id:id==='e4'?'codex:two':'hermes:one',event_id:id,source_ref:'line:'+id,description:'Evidence '+id,excerpt:null})));
  r.recommendations.push(
    {...rec,id:'rec2',finding_ids:['f2']},
    {...rec,id:'rec3',finding_ids:['f3']},
    {...rec,id:'rec4',finding_ids:['f4'],action:'Investigate a different cause'}
  );
  r.summary.finding_count=4;
  r.coverage.limitations=['Unmatched result','Unmatched result','Other limitation'];
  renderReport(r,doc as unknown as Document);
  assert.equal(doc.elements.findings.querySelectorAll('article').length,2);
  assert.equal(doc.elements.recommendations.querySelectorAll('article').length,2);
  assert.match(doc.elements['finding-count'].textContent,/2 types.*4 observations/);
  assert.match(doc.elements.findings.textContent,/3 occurrences/);
  assert.match(doc.elements.findings.textContent,/Second occurrence/);
  assert.match(doc.elements.findings.textContent,/Third occurrence/);
  assert.match(doc.elements.findings.textContent,/line:e3/);
  assert.match(doc.elements.findings.textContent,/A different cause/);
  assert.match(doc.elements.recommendations.textContent,/3 occurrences/);
  assert.equal(doc.elements['coverage-details'].querySelectorAll('li').length,2);
  assert.match(doc.elements['coverage-details'].textContent,/Unmatched result.*2 occurrences/);
  doc.elements['agent-filter'].value='hermes';doc.elements['agent-filter'].dispatch('change');
  assert.equal(doc.elements.findings.querySelectorAll('article').length,1);
  assert.equal(doc.elements.recommendations.querySelectorAll('article').length,1);
  assert.match(doc.elements['finding-count'].textContent,/1 type.*3 observations/);
  assert.doesNotMatch(doc.elements.findings.textContent,/A different cause/);
});
test('embedded report, filter and clear keep scope and report-wide metrics',()=>{
  const doc=documentFixture(); const r=populated(); doc.elements['embedded-report'].textContent=JSON.stringify(r); bootstrap(doc as unknown as Document);
  doc.elements['agent-filter'].value='codex'; doc.elements['agent-filter'].dispatch('change');
  assert.equal(doc.elements['sessions-body'].querySelectorAll('tr').length,1);
  assert.doesNotMatch(doc.elements.findings.textContent,/Calls repeated/);
  assert.doesNotMatch(doc.elements.recommendations.textContent,/Review calls/);
  assert.doesNotMatch(doc.elements.candidates.textContent,/Reusable work/);
  assert.match(doc.elements.tools.textContent,/shell/);
  assert.equal(selectScope(r,'hermes').findings.length,1);
  doc.elements['clear-button'].dispatch('click');
  assert.equal(doc.elements['report-view'].hidden,true);
  assert.equal(doc.elements['empty-state'].hidden,false);
});
test('drop import enforces size before reading and reports invalid JSON',async()=>{
  const doc=documentFixture(); bootstrap(doc as unknown as Document); let reads=0;
  doc.elements['drop-zone'].dispatch('drop',{dataTransfer:{files:[{size:MAX_FILE_BYTES+1,text:async()=>{reads++;return '{}';}}]}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads,0); assert.match(doc.elements['import-error'].textContent,/20 MiB/);
  doc.elements['report-file'].dispatch('change',{target:{files:[{size:1,text:async()=>'{'}]}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(doc.elements['import-error'].textContent,/Invalid JSON/);
  doc.elements['report-file'].dispatch('change',{target:{files:[{size:100,text:async()=>JSON.stringify(populated())}]}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(doc.elements['import-error'].hidden,true);
});
test('demo is labeled as a sanitized real session and resets filter',()=>{
  const doc=documentFixture(); bootstrap(doc as unknown as Document); doc.elements['agent-filter'].value='codex'; doc.elements['demo-button'].dispatch('click');
  assert.equal(doc.elements['demo-label'].hidden,false);
  assert.equal(doc.elements['agent-filter'].value,'all');
  assert.match(doc.elements['demo-label'].textContent,/REAL SESSION.*SANITIZED/);
});
test('browser module attaches API and initializes once DOM is ready',async()=>{
  const doc=documentFixture();
  let ready: (()=>void) | undefined;
  const fakeWindow={document:{...doc,readyState:'loading',addEventListener:(type:string,fn:()=>void)=>{if(type==='DOMContentLoaded') ready=fn;}}} as unknown as Window & {SessionAnalysis?: {bootstrap: typeof bootstrap}};
  const previous=(globalThis as {window?: Window}).window;
  try {
    (globalThis as {window?: Window}).window=fakeWindow;
    const moduleUrl=new URL('../src/web/app.ts',import.meta.url);
    moduleUrl.search='?browser-bootstrap';
    await import(moduleUrl.href);
    assert.equal(fakeWindow.SessionAnalysis?.bootstrap instanceof Function,true);
    assert.equal(doc.elements['demo-button'].listeners.click,undefined);
    ready?.();
    assert.equal(doc.elements['demo-button'].listeners.click?.length,1);
  } finally {
    if(previous === undefined) delete (globalThis as {window?: Window}).window;
    else (globalThis as {window?: Window}).window=previous;
  }
});

test('local file viewer boots its compiled script and the demo button renders',()=>{
  const doc=documentFixture();
  const browserWindow={document:{...doc,readyState:'complete'}};
  const browserScript=readFileSync(fileURLToPath(new URL('../web/app.js',import.meta.url)),'utf8');
  runInNewContext(browserScript,{structuredClone,window:browserWindow,TextEncoder,Event},{filename:'web/app.js'});
  assert.match(html,/<script(?: defer)? src="app\.js"><\/script>/);
  doc.elements['demo-button'].dispatch('click');
  assert.equal(doc.elements['report-view'].hidden,false);
  assert.equal(doc.elements['demo-label'].hidden,false);
});

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const localFile=(name:string,text:string)=>({name,size:Buffer.byteLength(text),text:async()=>text});
test('workspace imports batches, keeps valid files after failures, and switches reports',async()=>{
  const doc=documentFixture();bootstrap(doc as unknown as Document);
  const second=report();second.report.id='second';
  doc.elements['report-file'].dispatch('change',{target:{files:[localFile('first.json',JSON.stringify(populated())),localFile('broken.json','{'),localFile('second.json',JSON.stringify(second))]}});
  await settle();
  assert.match(doc.elements['workspace-count'].textContent,/2 reports/);
  assert.match(doc.elements['import-error'].textContent,/broken.json.*Invalid JSON/);
  assert.match(doc.elements['report-label'].textContent,/synthetic/);
  const buttons=doc.elements['workspace-list'].querySelectorAll('button');
  buttons[2]!.dispatch('click');
  assert.match(doc.elements['report-label'].textContent,/second/);
  buttons[0]!.dispatch('click');
  assert.equal(doc.elements['sessions-body'].querySelectorAll('tr').length,2);
  // Re-importing an identical file does not add another entry.
  doc.elements['drop-zone'].dispatch('drop',{dataTransfer:{files:[localFile('second.json',JSON.stringify(second))]}});
  await settle();assert.match(doc.elements['workspace-count'].textContent,/2 reports/);
  doc.elements['clear-button'].dispatch('click');
  assert.match(doc.elements['workspace-count'].textContent,/1 reports/);
  assert.match(doc.elements['report-label'].textContent,/synthetic/);
});

test('multiple session logs are reused by identity across evidence and report switches',async()=>{
  const doc=documentFixture();bootstrap(doc as unknown as Document);
  const r=structuredClone(demoReport);r.report.demo=false;r.report.id='local';
  const other=report();other.report.id='other';
  const otherLog=demoLog.replaceAll('pages-demo','other-session').replaceAll('npm test','private other command');
  doc.elements['drop-zone'].dispatch('drop',{dataTransfer:{files:[localFile('local.json',JSON.stringify(r)),localFile('other.json',JSON.stringify(other)),localFile('other.jsonl',otherLog),localFile('matching.jsonl',demoLog)]}});
  await settle();
  assert.match(doc.elements['workspace-count'].textContent,/2 reports.*2 session logs/);
  const inspect=()=>doc.elements.findings.querySelectorAll('button')[0]!.dispatch('click');
  inspect();await settle();
  assert.match(doc.elements['source-status'].textContent,/matching.jsonl/);
  assert.equal(doc.elements['source-upload'].hidden,true);
  assert.match(doc.elements['source-view'].textContent,/npm test/);
  assert.doesNotMatch(doc.elements['source-view'].textContent,/private other command/);
  doc.elements['source-close'].dispatch('click');inspect();await settle();
  assert.match(doc.elements['source-view'].textContent,/npm test/);
  let buttons=doc.elements['workspace-list'].querySelectorAll('button');
  buttons[2]!.dispatch('click');buttons=doc.elements['workspace-list'].querySelectorAll('button');buttons[0]!.dispatch('click');
  inspect();await settle();assert.match(doc.elements['source-view'].textContent,/npm test/);
  // Remove the matching source; reopening must request a file again.
  doc.elements['workspace-list'].querySelectorAll('button').at(-1)!.dispatch('click');
  inspect();await settle();assert.equal(doc.elements['source-view'].textContent,'');
  assert.match(doc.elements['source-status'].textContent,/Choose the matching/);
  assert.equal(doc.elements['source-upload'].hidden,false);
  doc.elements['workspace-clear'].dispatch('click');
  assert.equal(doc.elements['workspace-files'].hidden,true);
  assert.equal(doc.elements['report-view'].hidden,true);
});

test('workspace clear cancels pending imports and invalid logs do not enter the workspace',async()=>{
  const doc=documentFixture();bootstrap(doc as unknown as Document);
  let finish!:(text:string)=>void;
  doc.elements['report-file'].dispatch('change',{target:{files:[{name:'pending.json',size:100,text:()=>new Promise<string>(resolve=>{finish=resolve;})}]}});
  await settle();doc.elements['workspace-clear'].dispatch('click');finish(JSON.stringify(report()));await settle();
  assert.equal(doc.elements['workspace-files'].hidden,true);
  assert.equal(doc.elements['report-view'].hidden,true);
  doc.elements['report-file'].dispatch('change',{target:{files:[localFile('bad.jsonl','{}\nnot json'),localFile('unknown.jsonl','{}')]}});
  await settle();assert.match(doc.elements['import-error'].textContent,/Invalid session JSONL.*one session identity/s);
  assert.equal(doc.elements['workspace-files'].hidden,true);
});

test('folder selection matches identities across subfolders, ignores unrelated files, and updates source status',async()=>{
  const doc=documentFixture();bootstrap(doc as unknown as Document);
  const r=structuredClone(demoReport);r.report.demo=false;
  doc.elements['report-file'].dispatch('change',{target:{files:[localFile('report.json',JSON.stringify(r))]}});
  await settle();assert.match(doc.elements['sessions-body'].textContent,/Log missing/);
  doc.elements.findings.querySelectorAll('button')[0]!.dispatch('click');
  assert.equal(doc.elements['source-help'].hidden,false);
  assert.match(doc.elements['source-help'].textContent,/pages-demo.*~\/.codex\/sessions/s);
  let ignoredReads=0;
  const matching={...localFile('renamed.jsonl',demoLog),webkitRelativePath:'logs/date/renamed.jsonl'};
  doc.elements['session-folder'].dispatch('change',{target:{files:[
    matching,localFile('unrelated.jsonl',demoLog.replaceAll('pages-demo','unrelated')),
    localFile('duplicate.jsonl',demoLog),localFile('invalid.jsonl','not json'),
    {name:'report.json',size:100,text:async()=>{ignoredReads++;return JSON.stringify(r);}},
    {name:'oversized.jsonl',size:MAX_FILE_BYTES+1,text:async()=>{ignoredReads++;return demoLog;}}
  ]}});
  await settle();
  assert.equal(ignoredReads,0);
  assert.match(doc.elements['workspace-count'].textContent,/1 reports.*1 session logs/);
  assert.match(doc.elements['import-status'].textContent,/Attached 1.*3 unrelated.*2 invalid/);
  assert.match(doc.elements['sessions-body'].textContent,/Log attached/);
  assert.match(doc.elements['source-view'].textContent,/npm test/);
  assert.equal(doc.elements['source-help'].hidden,true);
  doc.elements['workspace-list'].querySelectorAll('button').at(-1)!.dispatch('click');
  assert.match(doc.elements['sessions-body'].textContent,/Log missing/);
});

test('missing Claude source shows exact filename and copy feedback with a clipboard fallback',async()=>{
  const doc=documentFixture(),r=populated();
  r.sessions[0]!.agent='claude_code';r.sessions[0]!.id='claude_code:target-id';
  let copied='';
  const withClipboard={...doc,defaultView:{navigator:{platform:'MacIntel',clipboard:{writeText:async(text:string)=>{copied=text;}}}}};
  renderReport(r,withClipboard as unknown as Document);
  doc.elements['sessions-body'].querySelectorAll('button')[0]!.dispatch('click');
  assert.match(doc.elements.inspector.textContent,/Expected filename:target-id.jsonl/);
  assert.match(doc.elements.inspector.textContent,/⌘⇧G.*~\/.claude\/projects/);
  doc.elements.inspector.querySelectorAll('button')[0]!.dispatch('click');await settle();
  assert.equal(copied,'target-id.jsonl');assert.match(doc.elements.inspector.textContent,/Copied/);
  renderReport(r,doc as unknown as Document);
  doc.elements['sessions-body'].querySelectorAll('button')[0]!.dispatch('click');
  doc.elements.inspector.querySelectorAll('button')[0]!.dispatch('click');await settle();
  assert.match(doc.elements.inspector.textContent,/Select and copy the text shown/);
});

test('folder matching requires a report and clear cancels an in-progress folder scan',async()=>{
  const doc=documentFixture();bootstrap(doc as unknown as Document);
  let reads=0;
  doc.elements['session-folder'].dispatch('change',{target:{files:[{name:'a.jsonl',size:1,text:async()=>{reads++;return demoLog;}}]}});
  await settle();assert.equal(reads,0);assert.match(doc.elements['import-error'].textContent,/Open a report/);
  doc.elements['demo-button'].dispatch('click');
  let finish!:(text:string)=>void;
  doc.elements['session-folder'].dispatch('change',{target:{files:[{name:'a.jsonl',size:100,text:()=>new Promise<string>(resolve=>{finish=resolve;})}]}});
  await settle();doc.elements['workspace-clear'].dispatch('click');finish(demoLog);await settle();
  assert.equal(doc.elements['workspace-files'].hidden,true);assert.equal(doc.elements['import-status'].textContent,'');
});

test('platform detection uses client hints, then legacy browser information',()=>{
  assert.equal(detectPlatform({userAgentData:{platform:'Windows'},platform:'MacIntel'}),'windows');
  assert.equal(detectPlatform({platform:'MacIntel'}),'mac');
  assert.equal(detectPlatform({platform:'Linux x86_64'}),'linux');
  assert.equal(detectPlatform({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}),'windows');
  assert.equal(detectPlatform({}),'unknown');
});

test('clickable paths copy platform-specific locations and platform override updates session help',async()=>{
  const doc=documentFixture();let copied='';
  const browserDoc={...doc,defaultView:{navigator:{platform:'Win32',clipboard:{writeText:async(value:string)=>{copied=value;}}}}};
  bootstrap(browserDoc as unknown as Document);
  assert.equal(doc.elements['platform-select'].value,'windows');
  assert.match(doc.elements['session-path-guide'].textContent,/Windows:.*Alt\+D/s);
  assert.doesNotMatch(doc.elements['session-path-guide'].textContent,/⌘/);
  doc.elements['session-path-guide'].querySelectorAll('button')[0]!.dispatch('click');await settle();
  assert.equal(copied,'%USERPROFILE%\\.claude\\projects\\');
  assert.match(doc.elements['session-path-guide'].textContent,/Copied/);
  const r=structuredClone(demoReport);r.report.demo=false;
  doc.elements['report-file'].dispatch('change',{target:{files:[localFile('report.json',JSON.stringify(r))]}});await settle();
  doc.elements.findings.querySelectorAll('button')[0]!.dispatch('click');
  assert.match(doc.elements['source-help'].textContent,/%USERPROFILE%\\.codex\\sessions\\/);
  doc.elements['platform-select'].value='linux';doc.elements['platform-select'].dispatch('change');
  assert.match(doc.elements['session-path-guide'].textContent,/Linux:.*Ctrl\+L/s);
  assert.match(doc.elements['source-help'].textContent,/Linux:.*~\/.codex\/sessions/s);
  assert.doesNotMatch(doc.elements['source-help'].textContent,/%USERPROFILE%|⌘/);
  doc.elements['source-help'].querySelectorAll('button')[1]!.dispatch('click');await settle();
  assert.equal(copied,'~/.codex/sessions/');
  doc.elements['platform-select'].value='mac';doc.elements['platform-select'].dispatch('change');
  assert.match(doc.elements['source-help'].textContent,/macOS:.*⌘⇧G/s);
});

test('viewer records decisions independently of attempts and renders reviewer comments as text',()=>{
  const run=JSON.parse(readFileSync(new URL('../evaluations/contextual/run.json',import.meta.url),'utf8'));
  const outputs=JSON.parse(readFileSync(new URL('../evaluations/contextual/outputs.json',import.meta.url),'utf8'));
  const r=run.cases.find(c=>c.id==='ordinary-correction').report;
  const additions=outputs.outputs.find(c=>c.case_id==='ordinary-correction').interpretation;
  r.findings.push(...additions.findings);r.recommendations.push(...additions.recommendations);r.summary.finding_count=r.findings.length;
  const before=JSON.stringify(r),doc=documentFixture();renderReport(r,doc as unknown as Document);
  const selects=doc.elements.recommendations.querySelectorAll('select'),text=doc.elements.recommendations.querySelectorAll('textarea');
  selects[0].value='accept';selects[3].value='4';text[1].value='<script>reviewer reason</script>';
  doc.elements.recommendations.querySelectorAll('button').find(e=>e.textContent==='Save feedback in this workspace').dispatch('click');
  assert.match(doc.elements.recommendations.textContent,/accept; usefulness 4; not_attempted; follow-up missing/);assert.match(doc.elements.recommendations.textContent,/<script>reviewer reason<\/script>/);
  assert.equal(doc.elements.recommendations.querySelectorAll('script').length,0);assert.equal(JSON.stringify(r),before);
});
