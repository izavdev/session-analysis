import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { discover, loadSessions } from '../dist/adapters.js';

const fixtures = resolve('tests/fixtures');
function temp(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'adapter-test-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function jsonl(path: string, rows: unknown[]) { writeFileSync(path, rows.map(x => JSON.stringify(x)).join('\n')); }

test('Claude native fixture normalizes cache-inclusive input and source references', () => {
  const path = join(fixtures, 'claude_code.sanitized-real.jsonl');
  const rows = readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);
  const native = rows.at(-1).message.usage;
  const [s] = loadSessions(path);
  assert.equal(s.agent, 'claude_code');
  assert.equal(s.usage.input_tokens, native.input_tokens + native.cache_read_input_tokens + native.cache_creation_input_tokens);
  assert.equal(s.usage.output_tokens, native.output_tokens);
  assert.equal(s.events[0].source_ref, 'line:1');
});

test('Claude deduplicates UUID and message usage while linking skills and tool results', () => temp(dir => {
  const path = join(dir, 'claude.jsonl');
  const a = { type:'assistant', sessionId:'s', uuid:'a', message:{ id:'m', content:[{type:'tool_use',id:'c',name:'Skill',input:{skill:'example'}}], usage:{input_tokens:10,output_tokens:2,cache_read_input_tokens:4,cache_creation_input_tokens:3}}};
  const b = {type:'assistant',sessionId:'s',uuid:'b',message:{id:'m',content:'duplicate usage',usage:a.message.usage}};
  const r = {type:'user',sessionId:'s',uuid:'r',message:{content:[{type:'tool_result',tool_use_id:'c',content:'done',is_error:false}]}};
  jsonl(path,[a,a,b,r]);
  const [s] = loadSessions(path);
  assert.equal(s.usage.input_tokens,17);
  assert.equal(s.events.filter(e => e.type === 'tool_call').length,1);
  assert.equal(s.events.find(e => e.type === 'skill')?.skill_state,'invoked');
  assert.equal(s.events.find(e => e.type === 'tool_result')?.call_id,'c');
  jsonl(path,[r]);
  assert.equal(loadSessions(path)[0].coverage.usage,'unavailable');
}));

test('partial Claude usage retains known subtotals but not total', () => temp(dir => {
  const path = join(dir,'x.jsonl');
  jsonl(path,[
    {type:'assistant',sessionId:'s',uuid:'a',message:{id:'m1',content:'first',usage:{input_tokens:10,output_tokens:5}}},
    {type:'assistant',sessionId:'s',uuid:'b',message:{id:'m2',content:'second',usage:{input_tokens:7}}},
  ]);
  const [s] = loadSessions(path);
  assert.equal(s.coverage.usage,'partial');
  assert.equal(s.usage.input_tokens,17);
  assert.equal(s.usage.output_tokens,5);
  assert.equal(s.usage.total_tokens,null);
}));

test('Claude skips preamble and warns with reference only', () => temp(dir => {
  const path = join(dir,'x.jsonl');
  jsonl(path,[{type:'file-history-snapshot',text:'PRIVATE SENTINEL'}, {type:'user',sessionId:'s',message:{content:'request'}}]);
  const [s] = loadSessions(path);
  assert.equal(s.events[0].source_ref,'line:2');
  assert.ok(s.coverage.limitations.some(x => x.includes('Ignored 1 Claude file-history-snapshot record; first at line:1')));
  assert.ok(!JSON.stringify(s.coverage.limitations).includes('PRIVATE SENTINEL'));
}));

test('Claude metadata user records do not become repeatable user requests', () => temp(dir => {
  const path=join(dir,'x.jsonl');
  jsonl(path,[
    {type:'user',sessionId:'s',uuid:'meta',isMeta:true,message:{content:'injected session setup'}},
    {type:'user',sessionId:'s',uuid:'request',message:{content:'actual request'}}
  ]);
  const [s]=loadSessions(path);
  assert.deepEqual(s.events.filter(e=>e.type==='user').map(e=>e.text),['actual request']);
}));

test('Claude groups ignored record warnings by safe type instead of one per line', () => temp(dir => {
  const path=join(dir,'x.jsonl');
  jsonl(path,[
    {type:'attachment',text:'PRIVATE SENTINEL'},
    {type:'attachment',text:'PRIVATE SENTINEL'},
    {type:'file-history-snapshot',text:'PRIVATE SENTINEL'},
    {type:'user',sessionId:'s',message:{content:'request'}}
  ]);
  const [s]=loadSessions(path);
  assert.equal(s.coverage.limitations.length,2);
  assert.match(s.coverage.limitations[0],/Ignored 2 Claude attachment records; first at line:1/);
  assert.match(s.coverage.limitations[1],/Ignored 1 Claude file-history-snapshot record; first at line:3/);
  assert.ok(!JSON.stringify(s.coverage.limitations).includes('PRIVATE SENTINEL'));
}));

test('Codex rollout uses latest cumulative snapshot and observes native calls and skill reads', () => temp(dir => {
  const rows = readFileSync(join(fixtures,'codex.sanitized-real.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  const snapshot = rows.find(x => x.type === 'event_msg' && x.payload?.type === 'token_count');
  assert.ok(snapshot);
  rows.push(snapshot,snapshot,
    {type:'response_item',payload:{type:'function_call',name:'read_file',call_id:'c',arguments:'{"path":"skills/example/SKILL.md"}'}},
    {type:'response_item',payload:{type:'function_call_output',call_id:'c',output:'ok'}});
  const path = join(dir,'rollout.jsonl'); jsonl(path,rows);
  const [s] = loadSessions(path);
  assert.equal(s.agent,'codex');
  assert.equal(s.usage.input_tokens,snapshot.payload.info.total_token_usage.input_tokens);
  assert.equal(s.events.filter(e=>e.type==='tool_call').length,1);
  assert.equal(s.events.find(e=>e.type==='skill')?.skill_name,'example');
  assert.ok(!s.events.some(e=>e.usage !== undefined));
}));

test('Codex exec counts each completed turn and completed command only', () => temp(dir => {
  const path = join(dir,'exec.jsonl'); jsonl(path,[
    {type:'thread.started',thread_id:'exec'}, {type:'turn.started'},
    {type:'item.started',item:{id:'i',type:'command_execution',command:'printf test'}},
    {type:'item.completed',item:{id:'i',type:'command_execution',command:'printf test',aggregated_output:'test',exit_code:0}},
    {type:'turn.completed',usage:{input_tokens:10,cached_input_tokens:5,output_tokens:2}},
    {type:'turn.started'}, {type:'turn.completed',usage:{input_tokens:10,cached_input_tokens:5,output_tokens:2}},
    {type:'future_record',payload:{text:'PRIVATE SENTINEL'}}
  ]);
  const [s] = loadSessions(path);
  assert.equal(s.usage.input_tokens,20);
  assert.equal(s.usage.cache_read_tokens,10);
  assert.equal(s.events.filter(e=>e.type==='tool_call').length,1);
  assert.equal(s.events.find(e=>e.type==='tool_result')?.is_error,false);
  assert.ok(s.coverage.limitations.some(x=>x.includes('Unsupported')));
  assert.ok(!JSON.stringify(s.coverage.limitations).includes('PRIVATE SENTINEL'));
}));

test('Hermes SQLite introspects native columns, closes read-only and preserves counters', () => temp(dir => {
  const fixture = JSON.parse(readFileSync(join(fixtures,'hermes.sanitized-real.json'),'utf8'));
  const path = join(dir,'state.db');
  const db = new DatabaseSync(path);
  for (const [name, rows] of [['sessions',[fixture.session]],['messages',fixture.messages]] as const) {
    const keys = [...new Set(rows.flatMap(row=>Object.keys(row)))].sort();
    db.exec(`CREATE TABLE ${name} (${keys.join(',')})`);
    const insert = db.prepare(`INSERT INTO ${name} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`);
    for (const row of rows) insert.run(...keys.map(k=>(row as Record<string,unknown>)[k] ?? null) as (string | number | null)[]);
  }
  db.close();
  const before = readFileSync(path);
  const [s] = loadSessions(path);
  assert.deepEqual(readFileSync(path),before);
  assert.equal(s.agent,'hermes');
  const promptTotal=fixture.session.input_tokens+fixture.session.cache_read_tokens+fixture.session.cache_write_tokens;
  assert.equal(s.usage.input_tokens,promptTotal);
  assert.equal(s.usage.total_tokens,promptTotal+fixture.session.output_tokens);
  assert.equal(s.started_at,'2026-01-01T00:00:00Z');
  assert.equal(s.ended_at,'2026-01-01T00:00:05Z');
  assert.equal(s.events[0].source_ref,'message:1');
  assert.ok(s.events.length);
}));

test('Hermes sparse schema preserves parent, missing counters, unknown roles', () => temp(dir => {
  const path=join(dir,'state.db'); const db=new DatabaseSync(path);
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, parent_session_id TEXT, started_at REAL, input_tokens INTEGER, output_tokens INTEGER); CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL)');
  db.prepare('INSERT INTO sessions (id,parent_session_id,started_at) VALUES (?,?,?)').run('child','parent',1767225600);
  db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run(1,'child','future_role','PRIVATE SENTINEL',1767225601);
  db.close(); const [s]=loadSessions(path,'hermes');
  assert.equal(s.parent_id,'parent'); assert.equal(s.coverage.usage,'unavailable');
  assert.equal(s.usage.input_tokens,null);
  assert.ok(s.coverage.limitations.some(x=>x.includes('Unsupported')));
  assert.ok(!JSON.stringify(s.coverage.limitations).includes('PRIVATE SENTINEL'));
}));

test('Hermes historical role-message JSONL requires explicit selection', () => temp(dir => {
  const path=join(dir,'history.jsonl'); jsonl(path,[
    {role:'user',content:'prompt'},
    {role:'assistant',tool_calls:[{id:'c',function:{name:'skill_view',arguments:'{"name":"example"}'}}]},
    {role:'tool',tool_call_id:'c',content:'result'}
  ]);
  assert.throws(()=>loadSessions(path),/schema|mismatch/i);
  const [s]=loadSessions(path,'hermes');
  assert.equal(s.coverage.usage,'unavailable'); assert.equal(s.usage.total_tokens,null);
  assert.equal(s.events.find(e=>e.type==='skill')?.skill_state,'invoked');
}));

test('malformed final JSONL is warned, malformed interior and initial lines rejected without private text', () => temp(dir => {
  const path=join(dir,'x.jsonl');
  const good=JSON.stringify({type:'user',sessionId:'s',message:{content:'safe'}});
  writeFileSync(path,good+'\n{"PRIVATE SENTINEL"');
  assert.ok(loadSessions(path)[0].coverage.limitations.some(x=>x.includes('final')));
  writeFileSync(path,good+'\n{"PRIVATE SENTINEL"\n');
  assert.ok(loadSessions(path)[0].coverage.limitations.some(x=>x.includes('final')));
  writeFileSync(path,good+'\n{"PRIVATE SENTINEL"\n'+good);
  assert.throws(()=>loadSessions(path),e=>e instanceof Error && /line:?[ ]?2/.test(e.message) && !e.message.includes('PRIVATE SENTINEL'));
  for (const content of ['', 'PRIVATE SENTINEL', '[]', '{}', '{"role":"user","content":"PRIVATE SENTINEL"}']) {
    writeFileSync(path,content);
    assert.throws(()=>loadSessions(path),e=>e instanceof Error && !e.message.includes('PRIVATE SENTINEL'));
  }
}));

test('explicit mismatch, unsupported source and directory traversal reject correctly', () => temp(dir => {
  const path=join(dir,'x.jsonl');
  writeFileSync(path,readFileSync(join(fixtures,'claude_code.sanitized-real.jsonl')));
  assert.throws(()=>loadSessions(path,'codex'),/mismatch|schema/i);
  assert.throws(()=>loadSessions(path,'typo' as never),/Unsupported agent/);
  const nested=join(dir,'nested'); mkdirSync(nested);
  writeFileSync(join(nested,'codex.jsonl'),readFileSync(join(fixtures,'codex.sanitized-real.jsonl')));
  writeFileSync(join(dir,'ignored.txt'),'ignored');
  assert.deepEqual(new Set(loadSessions(dir).map(x=>x.agent)),new Set(['claude_code','codex']));
  assert.throws(()=>loadSessions(dir,'codex'),/mismatch|schema/i);
  const sql=join(dir,'unknown.db'); const db=new DatabaseSync(sql);db.exec('CREATE TABLE irrelevant (x)');db.close();
  assert.throws(()=>loadSessions(sql),/schema/i);
}));

test('invalid agent errors never echo attacker-controlled input', () => temp(dir => {
  const privateValue='PRIVATE SENTINEL';
  assert.throws(()=>discover(privateValue as never,dir),e=>e instanceof Error && !e.message.includes(privateValue));
  assert.throws(()=>loadSessions(join(dir,'missing'),privateValue as never),e=>e instanceof Error && !e.message.includes(privateValue));
}));

test('Codex cumulative partial usage retains known values without claiming total', () => temp(dir => {
  const path=join(dir,'rollout.jsonl');
  jsonl(path,[{type:'session_meta',payload:{id:'s'}},{type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:17}}}}]);
  const [s]=loadSessions(path);
  assert.equal(s.usage.input_tokens,17);
  assert.equal(s.usage.output_tokens,null);
  assert.equal(s.usage.total_tokens,null);
  assert.equal(s.coverage.usage,'partial');
}));

test('discover checks names only, root override, filters and environment override', () => temp(dir => {
  const paths=[join(dir,'.claude/projects/project/one.jsonl'),join(dir,'.codex/sessions/2026/09/one.jsonl'),join(dir,'.codex/archived_sessions/old.jsonl'),join(dir,'.hermes/state.db')];
  for(const path of paths){mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path,'PRIVATE SENTINEL not a transcript');}
  const found=discover('all',dir);
  assert.deepEqual(new Set(found.map(x=>x.path)),new Set(paths));
  assert.deepEqual(found.map(x=>x.agent).sort(),['claude_code','codex','codex','hermes']);
  assert.deepEqual(discover('codex',dir).map(x=>x.agent),['codex','codex']);
  assert.ok(!JSON.stringify(found).includes('PRIVATE SENTINEL'));
  assert.throws(()=>discover('typo' as never,dir),/Unsupported agent/);
  const old=process.env.CODEX_HOME; process.env.CODEX_HOME=join(dir,'.codex');
  try { assert.equal(discover('codex').some(x=>x.path===paths[1]),true); }
  finally { if(old===undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME=old; }
}));

test('skill invocation counts as a load only after a unique explicit successful result',()=>temp(dir=>{
  for(const status of [true,false,null,'missing','ambiguous']) {
    const path=join(dir,'skill.jsonl');
    const rows=[{type:'assistant',sessionId:'skill',uuid:'a',message:{content:[{type:'tool_use',id:'read',name:'Read',input:{file_path:'skills/example/SKILL.md'}}]}}];
    if(status!=='missing') rows.push({type:'user',sessionId:'skill',uuid:'b',message:{content:[{type:'tool_result',tool_use_id:'read',is_error:status==='ambiguous'?false:status,content:'contents'}]}});
    if(status==='ambiguous') rows.push({type:'user',sessionId:'skill',uuid:'c',message:{content:[{type:'tool_result',tool_use_id:'read',is_error:false,content:'other'}]}});
    jsonl(path,rows);const [s]=loadSessions(path);const skills=s.events.filter(e=>e.type==='skill');
    assert.equal(skills[0].skill_state,'invoked');assert.equal(skills.filter(e=>e.skill_state==='loaded').length,status===false?1:0);
    assert.ok(!skills.some(e=>e.skill_state==='applied'));
  }
}));
test('rollout structured status is explicit, prose status unknown; raw arguments preserved',()=>temp(dir=>{
  const path=join(dir,'rollout.jsonl');
  jsonl(path,[{type:'session_meta',payload:{id:'s'}},
    {type:'response_item',payload:{type:'function_call',call_id:'1',name:'read_file',arguments:'{ "path": "skills/demo/SKILL.md", "offset": 1 }'}},
    {type:'response_item',payload:{type:'function_call_output',call_id:'1',output:'{"exit_code":0,"output":"contents"}'}},
    {type:'response_item',payload:{type:'function_call',call_id:'2',name:'read_file',arguments:'{"offset":1,"path":"skills/demo/SKILL.md"}'}},
    {type:'response_item',payload:{type:'function_call_output',call_id:'2',output:'Error: command failed'}},
  ]);
  const [s]=loadSessions(path);assert.equal(s.coverage.observations.errors,'partial');
  const calls=s.events.filter(e=>e.type==='tool_call');assert.notEqual(calls[0].arguments,calls[1].arguments);assert.deepEqual(calls[0].comparison_arguments,calls[1].comparison_arguments);
  assert.deepEqual(s.events.filter(e=>e.type==='tool_result').map(e=>e.is_error),[false,null]);
  assert.equal(s.events.filter(e=>e.skill_state==='loaded').length,1);
}));
