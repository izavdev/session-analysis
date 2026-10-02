import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AgentName, EventType, NormalizedEvent, NormalizedSession, Usage } from './types.js';

type RecordValue = Record<string, unknown>;
type Row = [number, RecordValue];
const agents = ['claude_code', 'codex', 'hermes'] as const;
const keys = ['input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','reasoning_tokens','total_tokens'] as const;
const isObject = (v: unknown): v is RecordValue => v !== null && typeof v === 'object' && !Array.isArray(v);
const obj = (v: unknown): RecordValue => isObject(v) ? v : {};
const str = (v: unknown): string | null => typeof v === 'string' ? v : null;
const text = (v: unknown): string => typeof v === 'string' ? v : v == null ? '' : safeJson(v);
const safeJson = (v: unknown): string => JSON.stringify(v, (_k,x:unknown)=>typeof x === 'bigint' ? x.toString() : x) ?? '';
const hash = (v: string | Buffer): string => createHash('sha256').update(v).digest('hex');
const numeric = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : typeof v === 'bigint' && v >= 0n && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;

function usage(raw: unknown = {}, separateCache = false): Usage {
  const r = obj(raw);
  const aliases: Record<string,string> = {cache_read_tokens: separateCache ? 'cache_read_input_tokens' : 'cached_input_tokens', cache_write_tokens: separateCache ? 'cache_creation_input_tokens' : 'cache_write_input_tokens', reasoning_tokens:'reasoning_output_tokens'};
  const u = Object.fromEntries(keys.map(k=>[k,numeric(r[k] ?? r[aliases[k]])])) as unknown as Usage;
  if (separateCache && u.input_tokens !== null) u.input_tokens += (u.cache_read_tokens ?? 0)+(u.cache_write_tokens ?? 0);
  if (u.total_tokens === null && u.input_tokens !== null && u.output_tokens !== null) u.total_tokens = u.input_tokens + u.output_tokens;
  return u;
}
function makeSession(id: unknown, agent: AgentName, fingerprint: string, format: string): NormalizedSession {
  return {id:String(id),agent,agent_version:null,source:{format,fingerprint},started_at:null,ended_at:null,parent_id:null,relationship:null,events:[],usage:usage(),coverage:{usage:'unavailable',tools:'unavailable',limitations:[]}};
}
function add(s: NormalizedSession, type: EventType, ref: string, timestamp?: unknown, body: unknown = '', extra: Partial<NormalizedEvent> = {}): void {
  const when = str(timestamp);
  s.events.push({id:`e${s.events.length+1}`,type,timestamp:when,text:text(body),source_ref:ref,...extra});
  if(when){s.started_at ||= when;s.ended_at=when;}
  if(type === 'tool_call') s.coverage.tools='observed';
}
function finish(s: NormalizedSession, records: Usage[]): NormalizedSession {
  if(records.length){
    s.usage=Object.fromEntries(keys.map(k=>[k,records.some(u=>u[k] !== null) ? records.reduce((n,u)=>n+(u[k] ?? 0),0) : null])) as unknown as Usage;
    const complete=records.every(u=>u.input_tokens !== null && u.output_tokens !== null && u.total_tokens !== null);
    if(!complete){s.usage.total_tokens=null;s.coverage.limitations.push('One or more usage records lack input or output counts; known fields are partial subtotals.');}
    s.coverage.usage=complete?'reported':'partial';
  }
  return s;
}
function tool(s:NormalizedSession,ref:string,when:unknown,name:unknown,id:unknown,args:unknown,extra:Partial<NormalizedEvent>={}):void {
  const toolName=str(name) ?? 'unknown';
  add(s,'tool_call',ref,when,'',{tool_name:toolName,call_id:str(id) ?? undefined,arguments:args,...extra});
  let parsed=args;
  if(typeof parsed==='string') {try{parsed=JSON.parse(parsed);}catch{return;}}
  if(!isObject(parsed))return;
  let skill:unknown, state:'invoked'|'loaded'='loaded';
  if(toolName==='Skill'||toolName==='skill_view') {skill=parsed.skill ?? parsed.name;state=toolName==='Skill'?'invoked':'loaded';}
  else if(toolName==='Read'||toolName==='read_file') {
    const path=parsed.file_path ?? parsed.path;
    if(typeof path==='string' && basename(path)==='SKILL.md') skill=basename(dirname(path));
  }
  if(skill) add(s,'skill',ref,when,'',{skill_name:String(skill),skill_state:state,call_id:str(id) ?? undefined});
}
function stamp(v:unknown):string|null {
  if(typeof v==='number' && Number.isFinite(v)){const date=new Date(v*1000);return Number.isNaN(date.valueOf()) ? null : date.toISOString().replace('.000Z','Z');}
  return str(v);
}
function parsed(value: unknown): unknown {
  if(typeof value==='string') {try{return JSON.parse(value);}catch{return null;}}
  return value;
}
function hermesMessage(s:NormalizedSession,m:RecordValue,ref:string):void {
  const role=m.role;
  if(!['user','assistant','tool','system'].includes(String(role))){s.coverage.limitations.push(`Unsupported Hermes role at ${ref}`);return;}
  let content=m.content ?? '';
  if(typeof content==='string' && content.startsWith('\0json:')) content=parsed(content.slice(6)) ?? '';
  const when=stamp(m.timestamp);
  if((role==='user'||role==='assistant') && content) add(s,role,ref,when,content,{model:str(m.model),provider:str(m.provider)});
  else if(role==='tool') add(s,'tool_result',ref,when,content,{call_id:str(m.tool_call_id) ?? undefined,tool_name:str(m.tool_name) ?? undefined,is_error:typeof m.is_error==='boolean'?m.is_error:null});
  const calls=parsed(m.tool_calls) ?? [];
  if(Array.isArray(calls))for(const raw of calls){const call=obj(raw), fn=obj(call.function);tool(s,ref,when,fn.name,call.id,fn.arguments ?? {});}
}
function claude(rows:Row[],fingerprint:string):NormalizedSession[] {
  const id=rows.map(([,r])=>r).find(r=>['user','assistant'].includes(String(r.type)) && r.sessionId)?.sessionId;
  if(!id) throw new Error('Unrecognized Claude session schema');
  const s=makeSession(id,'claude_code',fingerprint,'claude-jsonl');
  const seen=new Set<string>(), usages=new Map<string,Usage>();
  const ignored=new Map<string,{count:number;first:number}>();
  for(const [line,r] of rows){
    if(r.type!=='user' && r.type!=='assistant'){
      const type=typeof r.type==='string' && /^[a-z][a-z0-9-]{0,39}$/.test(r.type)?r.type:'unrecognized';
      const group=ignored.get(type)??{count:0,first:line};group.count++;ignored.set(type,group);
      continue;
    }
    const id=str(r.uuid) ?? safeJson(r);
    if(seen.has(id))continue;seen.add(id);
    s.agent_version=str(r.version) ?? s.agent_version;
    if(r.type==='user' && r.isMeta===true) continue;
    const m=obj(r.message),content=m.content ?? [];
    const body=typeof content==='string'?content:Array.isArray(content)?content.filter(x=>obj(x).type==='text').map(x=>str(obj(x).text) ?? '').join('\n'):'';
    if(body)add(s,r.type,`line:${line}`,r.timestamp,body,{model:str(m.model),provider:'anthropic'});
    if(Array.isArray(content))for(const raw of content){const block=obj(raw);
      if(block.type==='tool_use')tool(s,`line:${line}`,r.timestamp,block.name,block.id,block.input ?? {});
      else if(block.type==='tool_result')add(s,'tool_result',`line:${line}`,r.timestamp,block.content ?? '',{call_id:str(block.tool_use_id) ?? undefined,is_error:typeof block.is_error==='boolean'?block.is_error:null});
    }
    if(isObject(m.usage) && Object.keys(m.usage).length)usages.set(str(m.id) ?? id,usage(m.usage,true));
  }
  for(const [type,{count,first}] of ignored) s.coverage.limitations.push(`Ignored ${count} Claude ${type} ${count===1?'record':'records'}; first at line:${first}.`);
  return [finish(s,[...usages.values()])];
}
function codexExec(rows:Row[],fingerprint:string):NormalizedSession {
  const meta=rows.find(([,r])=>r.type==='thread.started')![1];
  const s=makeSession(meta.thread_id ?? fingerprint.slice(0,16),'codex',fingerprint,'codex-exec-jsonl');
  let turn=0;const usages=new Map<number,Usage>(),completed=new Set<string>();
  for(const [i,r] of rows){const type=r.type,ref=`line:${i}`,when=r.timestamp;
    if(type==='turn.started')turn++;
    else if(type==='turn.completed')usages.set(turn,usage(r.usage));
    else if(type==='item.completed'){
      const item=obj(r.item),id=str(item.id) ?? ref;
      if(completed.has(id))continue;completed.add(id);
      if(item.type==='agent_message')add(s,'assistant',ref,when,item.text ?? '');
      else if(item.type==='command_execution'){
        tool(s,ref,when,'command_execution',id,{command:item.command ?? ''});
        const code=item.exit_code;
        add(s,'tool_result',ref,when,item.aggregated_output ?? '',{call_id:id,tool_name:'command_execution',is_error:code==null?null:code!==0});
      }else s.coverage.limitations.push(`Unsupported Codex exec item at ${ref}`);
    } else if(!['thread.started','item.started','item.updated','error'].includes(String(type)))s.coverage.limitations.push(`Unsupported Codex exec record at ${ref}`);
  }
  s.coverage.limitations.push('Exec stream may omit prompts, model identity, timestamps and unfinished tool calls.');
  return finish(s,[...usages.values()]);
}
function codex(rows:Row[],fingerprint:string):NormalizedSession {
  const meta=obj(rows.find(([,r])=>r.type==='session_meta')![1].payload);
  const s=makeSession(meta.id ?? meta.session_id ?? fingerprint.slice(0,16),'codex',fingerprint,'codex-rollout-jsonl');
  s.agent_version=str(meta.cli_version);s.started_at=str(meta.timestamp);
  let model:string|null=null,provider=str(meta.model_provider),cumulative:Usage|null=null;
  const seen=new Set<string>();
  for(const [i,r] of rows){const p=obj(r.payload),kind=p.type,type=r.type,ref=`line:${i}`,when=r.timestamp;
    if(type==='turn_context'){model=str(p.model) ?? model;provider=str(p.model_provider) ?? provider;}
    else if(type==='event_msg' && kind==='token_count'){
      const info=obj(p.info);if(isObject(info.total_token_usage) && Object.keys(info.total_token_usage).length)cumulative=usage(info.total_token_usage);
    }else if(type==='compacted')add(s,'compression',ref,when,p.message ?? '');
    else if(type==='response_item'){
      const id=str(p.call_id),key=`${kind}:${id}`;
      if(id && seen.has(key))continue;if(id)seen.add(key);
      if(kind==='message' && (p.role==='user'||p.role==='assistant')){
        const content=Array.isArray(p.content)?p.content:[];
        add(s,p.role,ref,when,content.map(b=>str(obj(b).text) ?? '').join('\n'),{model,provider});
      }else if(kind==='function_call'||kind==='custom_tool_call')tool(s,ref,when,p.name,id,p.arguments ?? p.input ?? '',{model,provider});
      else if(kind==='function_call_output'||kind==='custom_tool_call_output')add(s,'tool_result',ref,when,p.output ?? '',{call_id:id ?? undefined,is_error:null});
      else s.coverage.limitations.push(`Unsupported Codex response item at ${ref}`);
    }else if(type==='event_msg')s.coverage.limitations.push(`Unsupported Codex event at ${ref}`);
    else if(type!=='session_meta')s.coverage.limitations.push(`Unsupported Codex record at ${ref}`);
  }
  if(cumulative)s.coverage.limitations.push('Cumulative session usage only; no per-request attribution.');
  return finish(s,cumulative?[cumulative]:[]);
}
function regularFiles(path:string):string[]{
  let entries;try{entries=readdirSync(path,{withFileTypes:true});}catch{return [];}
  return entries.flatMap(e=>{
    const name=join(path,e.name);
    if(e.isDirectory())return regularFiles(name);
    return e.isFile()?[name]:[];
  });
}
export function discover(agent:'all'|AgentName='all',root?:string):Array<{agent:AgentName,path:string}>{
  if(agent!=='all' && !agents.includes(agent))throw new Error('Unsupported agent');
  const home=root ?? process.env.HOME ?? homedir();
  const bases:Record<AgentName,string>={
    claude_code:root?join(home,'.claude'):process.env.CLAUDE_CONFIG_DIR ?? join(home,'.claude'),
    codex:root?join(home,'.codex'):process.env.CODEX_HOME ?? join(home,'.codex'),
    hermes:root?join(home,'.hermes'):process.env.HERMES_HOME ?? join(home,'.hermes')
  };
  const found:Array<{agent:AgentName,path:string}>=[];
  for(const kind of agents){if(agent!=='all' && agent!==kind)continue;
    const files=kind==='hermes'?[join(bases.hermes,'state.db')]:kind==='claude_code'?regularFiles(join(bases.claude_code,'projects')).filter(p=>extname(p)==='.jsonl'):[...regularFiles(join(bases.codex,'sessions')),...regularFiles(join(bases.codex,'archived_sessions'))].filter(p=>extname(p)==='.jsonl');
    for(const path of files){try{if(statSync(path).isFile())found.push({agent:kind,path});}catch{/* disappeared while scanning */}}
  }
  return found.sort((a,b)=>a.agent.localeCompare(b.agent)||a.path.localeCompare(b.path));
}
function sqlite(path:string):NormalizedSession[]{
  let db:DatabaseSync;
  try{db=new DatabaseSync(path,{readOnly:true});}catch{throw new Error('Unable to open Hermes SQLite database');}
  try{
    db.exec('PRAGMA query_only=ON');
    for(const [table,required] of [['sessions',['id']],['messages',['id','session_id','role','content']]] as const){
      const columns=new Set((db.prepare(`PRAGMA table_info(${table})`).all() as RecordValue[]).map(x=>x.name));
      if(required.some(k=>!columns.has(k)))throw new Error(`Unsupported Hermes SQLite schema: missing ${table} columns`);
    }
    const out:NormalizedSession[]=[];
    for(const row of db.prepare('SELECT * FROM sessions ORDER BY id').all() as RecordValue[]){
      const messages=db.prepare('SELECT * FROM messages WHERE session_id=? ORDER BY id').all(row.id as string) as RecordValue[];
      const s=makeSession(row.id,'hermes',hash(safeJson([row,messages])),'hermes-sqlite');
      s.parent_id=str(row.parent_session_id);s.relationship=s.parent_id?'parent_session':null;
      for(const m of messages)hermesMessage(s,m,`message:${String(m.id)}`);
      s.started_at=stamp(row.started_at) ?? s.started_at;s.ended_at=stamp(row.ended_at) ?? s.ended_at;
      s.coverage.limitations.push('SQLite session counters lack per-request usage and historical model attribution.');
      // Hermes persists uncached input separately from cache reads and writes.
      out.push(finish(s,keys.some(k=>row[k]!=null)?[usage(row,true)]:[]));
    }
    return out;
  }catch(e){if(e instanceof Error && e.message.startsWith('Unsupported Hermes SQLite schema:'))throw e;throw new Error('Unable to read Hermes SQLite schema or sessions');}
  finally{db.close();}
}
export function loadSessions(path:string,agent:AgentName|'auto'='auto'):NormalizedSession[]{
  if(agent!=='auto' && !agents.includes(agent))throw new Error('Unsupported agent');
  let st;try{st=statSync(path);}catch{throw new Error('Session source unavailable');}
  if(st.isDirectory()){
    const files=regularFiles(path).filter(p=>['.jsonl','.db','.sqlite','.sqlite3'].includes(extname(p).toLowerCase())).sort();
    if(!files.length)throw new Error('No session files in directory');
    return files.flatMap(file=>loadSessions(file,agent));
  }
  let data:Buffer;try{data=readFileSync(path);}catch{throw new Error('Session source unreadable');}
  if(data.subarray(0,16).equals(Buffer.from('SQLite format 3\0'))){
    if(agent!=='auto' && agent!=='hermes')throw new Error('Agent does not match Hermes SQLite');
    return sqlite(path);
  }
  let lines:string[];try{lines=new TextDecoder('utf-8',{fatal:true}).decode(data).split(/\r?\n/);}catch{throw new Error('Invalid session text encoding');}
  const rows:Row[]=[];let truncated=false;
  let last=lines.length-1;
  while(last>=0 && !lines[last].trim())last--;
  for(let i=0;i<lines.length;i++){
    const line=lines[i];if(!line.trim())continue;
    let record:unknown;try{record=JSON.parse(line);}catch{
      if(i===last && rows.length){truncated=true;break;}
      throw new Error(`Invalid JSONL at line ${i+1}`);
    }
    if(!isObject(record))throw new Error(`Invalid JSONL record at line ${i+1}`);
    rows.push([i+1,record]);
  }
  if(!rows.length)throw new Error('Empty or invalid session file');
  const fingerprint=hash(data);
  let result:NormalizedSession[];
  if(agent==='hermes' && rows.some(([,r])=>['user','assistant','tool','system'].includes(String(r.role)))){
    const id=rows.find(([,r])=>r.session_id)?.[1].session_id ?? fingerprint.slice(0,16);
    const s=makeSession(id,'hermes',fingerprint,'hermes-jsonl');
    for(const [line,r] of rows)hermesMessage(s,r,`line:${line}`);
    s.coverage.limitations.push('Historical role-message JSONL has no reliable token accounting; Hermes attribution explicitly selected.');
    result=[s];
  }else if(rows.some(([,r])=>r.type==='thread.started') && (agent==='auto'||agent==='codex'))result=[codexExec(rows,fingerprint)];
  else if(rows.some(([,r])=>r.type==='session_meta') && (agent==='auto'||agent==='codex'))result=[codex(rows,fingerprint)];
  else if(rows.some(([,r])=>r.sessionId && ['user','assistant'].includes(String(r.type))) && (agent==='auto'||agent==='claude_code'))result=claude(rows,fingerprint);
  else throw new Error('Unrecognized session schema or agent mismatch');
  if(truncated)for(const s of result)s.coverage.limitations.push('Malformed final JSONL line ignored.');
  return result;
}
