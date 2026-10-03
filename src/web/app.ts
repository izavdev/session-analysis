/* Session Analysis — offline, read-only report viewer. */
import {createFeedback,feedbackDraft,appendFeedback,validateFeedback,reportFingerprint} from '../feedback.ts';
import type {FeedbackFile,FeedbackEntry} from '../feedback.ts';
import demoData from '../../web/examples/codex-pages-report.json' with {type:'json'};
import demoSource from './demo-source.json' with {type:'json'};
import type {AgentName, UsageCoverage, EventType, Usage, NormalizedEvent, NormalizedSession, ReportSession, Finding, Recommendation, SkillCandidate, Evidence, Report} from '../types.js';
type Obj = Record<string, any>;
type Check = (value: any) => boolean;
const root: Window | undefined = typeof window === 'undefined' ? undefined : window;
  const object = (v: any): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
  const string = (v: any): v is string => typeof v === 'string';
  const count = (v: any) => Number.isSafeInteger(v) && v >= 0;
  const nullableString = (v: any) => v === null || string(v);
  const token = (v: any) => v === null || count(v);
  const list = (check: Check): Check => (v: any) => Array.isArray(v) && v.every(check);
  const oneOf = (values: string[]): Check => (v: any) => values.includes(v);
  const usage = {input_tokens:token,output_tokens:token,cache_read_tokens:token,cache_write_tokens:token,reasoning_tokens:token,total_tokens:token};
  export function validateReport(value: unknown): string[] {
    const errors: string[] = [];
    function shape(v: any, fields: Record<string, Check>, at: string) {
      if (!object(v)) { errors.push(at + ' must be an object.'); return; }
      for (const [key, check] of Object.entries(fields)) if (!check(v[key])) errors.push(at + '.' + key + ' is missing or invalid.');
    }
    function rows(v: any, fields: Record<string, Check>, at: string) {
      if (Array.isArray(v)) v.forEach((item,i) => shape(item, fields, at + '[' + i + ']'));
    }
    const strings = list(string), array: Check = Array.isArray;
    shape(value, {schema_version:v=>v==='1.0.0',report:object,scope:object,coverage:object,summary:object,sessions:array,metrics:object,findings:array,recommendations:array,skill_candidates:array,evidence:array,analysis_usage:object,privacy:object}, 'Report');
    if (!object(value)) return errors;
    shape(value.report,{id:string,generated_at:v=>string(v)&&Number.isFinite(Date.parse(v)),analyzer_version:string,mode:oneOf(['single_session','multi_session']),status:oneOf(['complete','partial']),demo:v=>typeof v==='boolean'},'report');
    shape(value.scope,{session_ids:strings,excluded_sessions:list(object)},'scope');
    const coverage={usage:oneOf(['reported','partial','unavailable']),limitations:strings};
    shape(value.coverage,coverage,'coverage');
    shape(value.summary,{session_count:count,tool_call_count:count,finding_count:count,input_tokens:token,output_tokens:token,total_tokens:token},'summary');
    shape(value.metrics,{tools:array,skills:array},'metrics');
    if (object(value.metrics)) {
      rows(value.metrics.tools,{name:string,calls:count,errors:count,output_chars:count},'metrics.tools');
      rows(value.metrics.skills,{name:string,loads:count,states:strings},'metrics.skills');
    }
    rows(value.sessions,{id:string,agent:oneOf(['claude_code','codex','hermes']),agent_version:nullableString,started_at:nullableString,ended_at:nullableString,parent_id:nullableString,relationship:nullableString,usage:object,coverage:object,metrics:object,model_runs:array,timeline:array},'sessions');
    if (Array.isArray(value.sessions)) value.sessions.forEach((s: unknown, i: number)=> {
      if (!object(s)) return;
      shape(s.usage,usage,'sessions['+i+'].usage');
      shape(s.coverage,{...coverage,tools:oneOf(['observed','unavailable'])},'sessions['+i+'].coverage');
      shape(s.metrics,{tool_call_count:count,tool_error_count:count,skill_load_count:count,event_count:count},'sessions['+i+'].metrics');
      rows(s.model_runs,{model:nullableString,provider:nullableString},'model_runs');
      rows(s.timeline,{event_id:string,type:string,timestamp:nullableString,tool_name:nullableString,source_ref:string},'timeline');
    });
    rows(value.findings,{id:string,category:string,rule_id:string,title:string,severity:oneOf(['low','medium','high']),claim_type:oneOf(['observed','inferred']),confidence:oneOf(['low','medium','high']),session_ids:strings,evidence_ids:strings,observation:string,interpretation:string,recommendation_ids:strings},'findings');
    rows(value.recommendations,{id:string,title:string,action:string,kind:oneOf(['skill','script','template','instruction','workflow','investigate']),priority:oneOf(['low','medium','high']),finding_ids:strings,overlap_group:nullableString},'recommendations');
    rows(value.skill_candidates,{id:string,title:string,trigger:string,session_ids:strings,evidence_ids:strings,recommendation:oneOf(['create','extend','merge','defer']),rationale:string,acceptance_tests:strings},'skill_candidates');
    rows(value.evidence,{id:string,session_id:string,event_id:string,source_ref:string,description:string,excerpt:nullableString},'evidence');
    shape(value.analysis_usage,{mode:oneOf(['metrics_only','assisted']),model_tokens:token,notes:strings},'analysis_usage');
    shape(value.privacy,{raw_transcripts_included:v=>v===false,excerpts_included:v=>typeof v==='boolean',redaction_applied:v=>typeof v==='boolean',safe_to_share:v=>v===null},'privacy');
    return errors;
  }
  export const MAX_FILE_BYTES = 20 * 1024 * 1024;
  type ClaudeSourceTarget = {source_ref: string; type: 'tool_call' | 'tool_result' | 'user' | 'assistant'};
  const sourceTypes=new Set(['tool_call','tool_result','user','assistant']);
  type ClaudeSourceEntry = {line: number; title: string; content: string; truncated: boolean};
  function describeToolInput(name: unknown, input: unknown): string {
    if (!object(input)) return '';
    if (name==='Read' && string(input.file_path)) {
      const offset=count(input.offset)&&input.offset>0?input.offset:1;
      return count(input.limit)&&input.limit>0?`Read up to ${input.limit} lines starting at line ${offset}: ${input.file_path}`:
        input.offset===undefined?`Read file (tool may limit output): ${input.file_path}`:`Read from line ${offset}: ${input.file_path}`;
    }
    if (name!=='Bash' || !string(input.command)) return '';
    // Deliberately not a shell parser. Only recognize literal cat/sed reads; never evaluate logged commands.
    const path='(?:[A-Za-z0-9_./-]+|"[A-Za-z0-9_./ -]+"|\'[A-Za-z0-9_./ -]+\')';
    const segments=input.command.trim().split(/\s*&&\s*/);
    const descriptions=segments.map((segment:string)=>{
      const literalPath=(value:string)=>value.replace(/^["']|["']$/g,'');
      let match=new RegExp(`^cat\\s+(${path})$`).exec(segment);
      if(match) return literalPath(match[1]!).startsWith('-')?null:`Read whole file: ${literalPath(match[1]!)}`;
      match=new RegExp(`^sed\\s+-n\\s+(['"]?)(\\d+),(\\d+)p\\1\\s+(${path})$`).exec(segment);
      if(match && Number(match[2])>0 && Number(match[3])>=Number(match[2]) && !literalPath(match[4]!).startsWith('-')) return `Read lines ${match[2]}–${match[3]}: ${literalPath(match[4]!)}`;
      return null;
    });
    return descriptions.every(Boolean)?descriptions.join('\n'):'';
  }
  /** Resolve report line references only after the reader explicitly selects a local Claude JSONL. */
  export function inspectClaudeLog(text: string, sessionId: string, targets: ClaudeSourceTarget[], size?: number): ClaudeSourceEntry[] {
    if ((size !== undefined && size > MAX_FILE_BYTES) || new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error('Source log exceeds the 20 MiB import limit.');
    if (!sessionId.startsWith('claude_code:') || !targets.length) throw new Error('Select Claude Code tool evidence first.');
    const rows=text.split('\n');
    const seenCalls=new Set<string>();
    const seenResults=new Set<string>();
    if(targets.length>40) throw new Error('Select at most 40 source events at a time.');
    const entries=targets.map(target=>{
      const match=/^line:([1-9]\d*)$/.exec(target.source_ref);
      if (!match || !sourceTypes.has(target.type)) throw new Error('Invalid source reference.');
      const line=Number(match[1]);
      if (!Number.isSafeInteger(line) || !rows[line-1]) throw new Error(`Source line ${line} is missing from the selected file.`);
      let record: unknown;
      try { record=JSON.parse(rows[line-1]!); } catch { throw new Error(`Source line ${line} is not valid JSON.`); }
      if (!object(record) || record.sessionId !== sessionId.slice('claude_code:'.length)) throw new Error(`Source line ${line} belongs to a different session.`);
      if(target.type==='user'||target.type==='assistant') {
        if(record.isMeta===true)throw new Error('Injected metadata is not a user request.');
        const body=textOf(record);
        if(record.type!==target.type || !body) throw new Error(`Source line ${line} does not contain the expected ${target.type} text.`);
        return {line,title:`line ${line} · ${target.type==='user'?'user request':'assistant context'}`,content:body.slice(0,4000),truncated:body.length>4000};
      }
      const role=target.type==='tool_call'?'assistant':'user';
      const blockType=target.type==='tool_call'?'tool_use':'tool_result';
      const blocks=object(record.message) && Array.isArray(record.message.content) ? record.message.content.filter((b: unknown)=>object(b) && b.type===blockType) as Obj[] : [];
      if (record.type !== role || !blocks.length) throw new Error(`Source line ${line} does not contain the expected ${target.type}.`);
      const parts=blocks.map(block=>{
        if (target.type==='tool_call') {
          if (string(block.id)) seenCalls.add(block.id);
          const description=describeToolInput(block.name,block.input);
          const command=object(block.input)&&string(block.input.command)?`Command (not executed):\n${block.input.command}\n\n`:'';
          return `${description?description+'\n\n':''}${string(block.name)?block.name:'Unnamed tool'} · input\n${command}${JSON.stringify(block.input ?? {},null,2)}`;
        }
        if (string(block.tool_use_id)) seenResults.add(block.tool_use_id);
        const value=block.content;
        const output=string(value)?value:Array.isArray(value)?value.map(part=>object(part) && part.type==='text' && string(part.text)?part.text:'[Non-text content omitted]').join('\n'):JSON.stringify(value ?? '');
        return `Tool result${block.is_error===true?' · error':''}\n${output}`;
      }).join('\n\n');
      const limit=100_000;
      return {line,title:`line ${line} · ${target.type==='tool_call'?'tool call':'tool result'}`,content:parts.slice(0,limit),truncated:parts.length>limit};
    });
    if (seenCalls.size && seenResults.size && [...seenResults].some(id=>!seenCalls.has(id))) throw new Error('The selected tool result does not match the selected call.');
    const first=Math.min(...entries.map(e=>e.line)),last=Math.max(...entries.map(e=>e.line));
    function recordAt(line:number):Obj|null {
      try {const row:unknown=JSON.parse(rows[line-1]??'');return object(row)?row:null;} catch {return null;}
    }
    function textOf(record:Obj):string {
      if(!object(record.message)) return '';
      const content=record.message.content;
      return string(content)?content:Array.isArray(content)?content.filter(b=>object(b)&&b.type==='text'&&string(b.text)).map(b=>b.text).join('\n'):'';
    }
    function bounded(line:number,title:string,content:string):ClaudeSourceEntry {return {line,title,content:content.slice(0,4000),truncated:content.length>4000};}
    const context:ClaudeSourceEntry[]=[];
    let request:ClaudeSourceEntry|undefined,explanation:ClaudeSourceEntry|undefined;
    for(let line=first;line>=Math.max(1,first-100);line--) {
      const row=recordAt(line);if(!row)continue;
      if(string(row.sessionId)&&row.sessionId!==sessionId.slice('claude_code:'.length))break;
      if(row.sessionId!==sessionId.slice('claude_code:'.length)||row.isMeta===true)continue;
      const body=textOf(row);
      if(row.type==='assistant' && body && !explanation) explanation=bounded(line,`line ${line} · Preceding assistant context`,body);
      if(row.type==='user' && body) {request=bounded(line,`line ${line} · Preceding user request`,body);break;}
    }
    if(request) {
      if(!targets.some(target=>target.type==='user'&&target.source_ref===`line:${request.line}`))context.push(request);
    } else context.push(bounded(first,'Context limitation','Preceding user request not found in the bounded context window (up to 100 source lines).'));
    if(explanation)context.push(explanation);
    let next:ClaudeSourceEntry|undefined;
    for(let line=last+1;line<=Math.min(rows.length,last+20);line++) {
      const row=recordAt(line);if(!row)continue;
      if(string(row.sessionId)&&row.sessionId!==sessionId.slice('claude_code:'.length))break;
      if(row.sessionId!==sessionId.slice('claude_code:'.length)||row.isMeta===true)continue;
      if(row.type==='user' && textOf(row))break;
      if(row.type!=='assistant' || !object(row.message))continue;
      const blocks=Array.isArray(row.message.content)?row.message.content:[];
      const tools=blocks.filter(b=>object(b)&&b.type==='tool_use').map(b=>`${b.name || 'Unnamed tool'} · input\n${JSON.stringify(b.input??{},null,2)}`).join('\n');
      const body=[textOf(row),tools].filter(Boolean).join('\n');
      if(body) {next=bounded(line,`line ${line} · Next recorded action (not a verified outcome)`,body);break;}
    }
    return [...context,...entries,...(next?[next]:[bounded(last,'Context limitation','Next action not found within 20 source lines, or a new user request/session boundary intervened.')])];
  }
  /** Read Codex rollout records as inert text, validating identity and selected event types. */
  export function inspectCodexLog(text: string, sessionId: string, targets: ClaudeSourceTarget[], size?: number): ClaudeSourceEntry[] {
    if ((size !== undefined && size > MAX_FILE_BYTES) || new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error('Source log exceeds the 20 MiB import limit.');
    if (!sessionId.startsWith('codex:') || !targets.length || targets.length>40) throw new Error('Select 1–40 Codex source events.');
    const rows=text.split('\n').map(row=>{try {const value:unknown=JSON.parse(row);return object(value)?value:null;} catch {return null;}});
    const metadata=rows.filter(row=>row?.type==='session_meta');
    if(metadata.length!==1 || !object(metadata[0]!.payload) || (metadata[0]!.payload.id ?? metadata[0]!.payload.session_id)!==sessionId.slice(6)) throw new Error('The selected file belongs to a different session or is not a Codex rollout.');
    const payloadAt=(line:number):Obj|null=>{const row=rows[line-1];return row?.type==='response_item' && object(row.payload)?row.payload:null;};
    const body=(p:Obj)=>Array.isArray(p.content)?p.content.filter(b=>object(b)&&['input_text','output_text','text'].includes(b.type)&&string(b.text)).map(b=>b.text).join('\n'):'';
    const resultText=(value:string):string=>{
      // Some Codex tools return serialized runner responses. Show their output
      // as plain text while retaining the other recorded response fields.
      try {
        const response:unknown=JSON.parse(value);
        if(object(response)&&string(response.output)) {
          const {output,...metadata}=response;
          return `Recorded response metadata: ${JSON.stringify(metadata)}\n${output}`;
        }
      } catch { /* Ordinary output is already text. */ }
      return value;
    };
    const isText=(p:Obj,role:string)=>p.type==='message' && p.role===role && !!body(p) && !/^\s*<(?:environment_context|INSTRUCTIONS|permissions|skills_instructions)\b/i.test(body(p));
    const calls=new Set<string>(),results=new Set<string>();
    const bounded=(line:number,title:string,content:string,limit=4000)=>({line,title:`line ${line} · ${title}`,content:content.slice(0,limit),truncated:content.length>limit});
    const entries=targets.map(target=>{
      const match=/^line:([1-9]\d*)$/.exec(target.source_ref);
      if(!match || !sourceTypes.has(target.type))throw new Error('Invalid source reference.');
      const line=Number(match[1]),p=payloadAt(line);
      if(!Number.isSafeInteger(line)||!p)throw new Error(`Source line ${line} is missing or is not a response item.`);
      if(target.type==='user'||target.type==='assistant') {
        if(!isText(p,target.type))throw new Error(`Source line ${line} does not contain expected text (injected metadata is excluded).`);
        return bounded(line,target.type,body(p));
      }
      const call=target.type==='tool_call';
      if(!(call?['function_call','custom_tool_call']:['function_call_output','custom_tool_call_output']).includes(p.type) || !string(p.call_id) || !p.call_id)throw new Error(`Source line ${line} does not contain the expected ${target.type} with a call ID.`);
      (call?calls:results).add(p.call_id);
      const output=Array.isArray(p.output)?p.output.map(b=>object(b)&&string(b.text)?resultText(b.text):'[Non-text content omitted]').join('\n'):string(p.output)?resultText(p.output):JSON.stringify(p.output??'');
      return bounded(line,call?'tool call':'tool result',call?`${p.name || 'Unnamed tool'} · input (not executed)\n${p.arguments ?? p.input ?? ''}`:`Tool result\n${output}`,100_000);
    });
    if(calls.size && results.size && [...results].some(id=>!calls.has(id)))throw new Error('The selected tool result does not match the selected call.');
    const first=Math.min(...entries.map(e=>e.line)),last=Math.max(...entries.map(e=>e.line));
    const context:ClaudeSourceEntry[]=[];
    let request:ClaudeSourceEntry|undefined,explanation:ClaudeSourceEntry|undefined,next:ClaudeSourceEntry|undefined;
    for(let line=first-1;line>=Math.max(1,first-100);line--) {
      const p=payloadAt(line);if(!p)continue;
      if(isText(p,'assistant')&&!explanation)explanation=bounded(line,'Preceding assistant context',body(p));
      if(isText(p,'user')) {request=bounded(line,'Preceding user request',body(p));break;}
    }
    context.push(request??bounded(first,'Context limitation','Preceding user request not found within 100 source lines.'));
    if(explanation)context.push(explanation);
    for(let line=last+1;line<=Math.min(rows.length,last+20);line++) {
      const p=payloadAt(line);if(!p)continue;
      if(p.type==='message'&&p.role==='user')break;
      if(isText(p,'assistant')) {next=bounded(line,'Next recorded assistant context (not a verified outcome)',body(p));break;}
      if(['function_call','custom_tool_call'].includes(p.type)) {next=bounded(line,'Next recorded action (not a verified outcome)',`${p.name}\n${p.arguments??p.input??''}`);break;}
    }
    return [...context,...entries,next??bounded(last,'Context limitation','Next action not found within 20 source lines, or a new user request intervened.')];
  }
  const demoReport=demoData as unknown as Report;
  export function parseReport(text: string, size?: number): Report {
    if ((size !== undefined && size > MAX_FILE_BYTES) || new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error('Report exceeds the 20 MiB import limit.');
    let value: unknown;
    try { value = JSON.parse(text); } catch (_) { throw new Error('Invalid JSON. Choose an exported Session Analysis report.'); }
    const errors = validateReport(value);
    if (errors.length) throw new Error(errors.slice(0,8).join('\n'));
    return value as Report;
  }
  export function selectScope(report: Report, agent: string) {
    const sessions = report.sessions.filter(s => agent === 'all' || s.agent === agent);
    const ids = new Set(sessions.map(s => s.id));
    const included = (item: {session_ids: string[]}) => agent === 'all' || item.session_ids.some(id => ids.has(id));
    return {sessions, findings:report.findings.filter(included), candidates:report.skill_candidates.filter(included)};
  }
  export function formatNumber(value: number | null | undefined): string { return value === null || value === undefined ? 'Unavailable' : Number(value).toLocaleString('en-US'); }
  type Platform = 'mac' | 'windows' | 'linux' | 'unknown';
  const platformChoices=new WeakMap<Document,Platform>();
  export function detectPlatform(nav?: {platform?: string; userAgent?: string; userAgentData?: {platform?: string}}): Platform {
    const value=nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || '';
    if(/Windows|Win32|Win64/i.test(value))return 'windows';
    if(/Mac/i.test(value))return 'mac';
    if(/Linux|X11/i.test(value))return 'linux';
    return 'unknown';
  }
  function currentPlatform(doc:Document):Platform {return platformChoices.get(doc) ?? detectPlatform(doc.defaultView?.navigator);}
  function copyButton(doc:Document,parent:HTMLElement,value:string,label=value):HTMLButtonElement {
    const button=doc.createElement('button');button.type='button';button.className='copy-path';button.textContent=label;
    button.setAttribute('aria-label',`Copy ${value}`);button.title=`Copy ${value}`;
    const feedback=doc.createElement('span');feedback.className='copy-feedback muted';feedback.setAttribute('role','status');
    let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
    let feedbackClearTimer: ReturnType<typeof setTimeout> | undefined;
    const showFeedback=(message:string)=>{
      if(feedbackTimer!==undefined)clearTimeout(feedbackTimer);
      if(feedbackClearTimer!==undefined)clearTimeout(feedbackClearTimer);
      feedback.textContent=message;
      feedback.classList.add('visible');
      feedbackTimer=setTimeout(()=>{
        feedback.classList.remove('visible');feedbackTimer=undefined;
        feedbackClearTimer=setTimeout(()=>{feedback.textContent='';feedbackClearTimer=undefined;},250);
      },2000);
    };
    button.onclick=()=>{void (async()=>{
      try {
        const clipboard=doc.defaultView?.navigator.clipboard;
        if(!clipboard)throw new Error('Clipboard unavailable');
        await clipboard.writeText(value);showFeedback('Copied');
      } catch {showFeedback('Select and copy the text shown.');}
    })();};
    parent.append(button,feedback);return button;
  }
  function pathGuide(doc:Document,parent:HTMLElement,agent?:AgentName):void {
    const platform=currentPlatform(doc),windows=platform==='windows';
    const p=doc.createElement('p');
    p.textContent=platform==='mac'?'macOS: press ⌘⇧G in the file or folder picker, then paste a path below. ⌘⇧. toggles hidden files.':
      windows?'Windows: click the address bar in the file or folder picker (Alt+D), then paste a path below and press Enter.':
      platform==='linux'?'Linux: in most file pickers, press Ctrl+L, then paste a path below and press Enter. Ctrl+H usually toggles hidden files.':
      'Choose your platform above for file-picker instructions. Copy a default path below to locate session logs.';
    parent.append(p);
    const paths: Array<[string,string]>=[];
    if(!agent || agent==='claude_code')paths.push(['Claude Code',windows?'%USERPROFILE%\\.claude\\projects\\':'~/.claude/projects/']);
    if(!agent || agent==='codex')paths.push(['Codex',windows?'%USERPROFILE%\\.codex\\sessions\\':'~/.codex/sessions/'],['Codex archive',windows?'%USERPROFILE%\\.codex\\archived_sessions\\':'~/.codex/archived_sessions/']);
    for(const [name,path] of paths) {
      const row=doc.createElement('p');row.append(doc.createTextNode(`${name}: `));copyButton(doc,row,path);parent.append(row);
    }
    const note=doc.createElement('p');note.className='muted';note.textContent='Click a path to copy it. These are default locations; custom installations may store logs elsewhere.';
    if(windows)note.textContent+=' For agents running in WSL, choose Linux above and locate the logs inside that WSL distribution.';
    parent.append(note);
  }
  const activityRules=new Set(['large_tool_output','repeated_skill_load','failed_tool_call']);
  const reviewOnlyRules=new Set([...activityRules,'repeated_tool_call','repeated_failed_attempt','recurring_user_request','synthetic-example']);
  type SourceFile = {name: string; text: string; size: number; sessionId: string};
  type Workspace = {reports: Array<{id: number; name: string; report: Report}>; sources: Map<string, SourceFile>; active: number | null; nextId: number; epoch: number; refresh?: () => void; sourcesChanged?: () => void};
  const workspaces=new WeakMap<Document,Workspace>();
  function workspaceFor(doc: Document): Workspace {
    let workspace=workspaces.get(doc);
    if (!workspace) {workspace={reports:[],sources:new Map(),active:null,nextId:0,epoch:0};workspaces.set(doc,workspace);}
    return workspace;
  }
  export function sourceSessionId(text: string): string {
    const ids=new Set<string>();
    for (const [index,line] of text.split('\n').entries()) {
      if (!line.trim()) continue;
      let row: unknown;
      try {row=JSON.parse(line);} catch {throw new Error(`Invalid session JSONL at line ${index+1}.`);}
      if (!object(row)) throw new Error(`Invalid session record at line ${index+1}.`);
      if (row.type==='session_meta' && object(row.payload)) {
        const id=row.payload.id ?? row.payload.session_id;
        if(string(id) && id) ids.add(`codex:${id}`);
      }
      if (string(row.sessionId) && row.sessionId) ids.add(`claude_code:${row.sessionId}`);
    }
    if(ids.size!==1) throw new Error('Choose a Claude Code or Codex JSONL containing one session identity.');
    return [...ids][0]!;
  }
  const feedbackFiles=new WeakMap<Document,Map<string,FeedbackFile>>();
  const reportGenerations=new WeakMap<Document,number>();
  export function renderReport(report: Report, doc: Document | undefined = root?.document): Report {
    const errors = validateReport(report);
    if (errors.length) throw new Error(errors.slice(0,8).join('\n'));
    if (!doc) return report;
    const generation=(reportGenerations.get(doc)??0)+1;
    reportGenerations.set(doc,generation);
    const byId = (id: string): HTMLElement => { const el = doc.getElementById(id); if (!el) throw new Error(`Missing viewer element: ${id}`); return el; };
    const node = (tag: string, text?: string | number, className?: string): HTMLElement => {
      const el = doc.createElement(tag);
      if (text !== undefined) el.textContent = String(text);
      if (className) el.className = className;
      return el;
    };
    const line = (parent: HTMLElement, tag: string, text?: string | number, className?: string): HTMLElement => { const el=node(tag,text,className); parent.append(el); return el; };
    const clear = (id: string, text?: string) => { const el=byId(id); el.replaceChildren(); if (text) el.textContent=text; return el; };
    const placeholder = (el: HTMLElement, text: string) => { if (!el.children.length) line(el,'p',text,'empty'); };
    byId('report-view').hidden=false;
    byId('empty-state').hidden=true;
    byId('import-error').hidden=true;
    byId('report-label').textContent=`Report ${report.report.id} · ${report.report.generated_at} · ${report.report.status}`;
    byId('demo-label').hidden=!report.report.demo;
    byId('demo-label').textContent=report===demoReport?'REAL SESSION · SANITIZED EXCERPT':'DEMO REPORT';
    byId('privacy-banner').textContent=`Opened files stay in your browser; nothing is uploaded. Report contents: Raw transcripts ${report.privacy.raw_transcripts_included?'included':'not included'}; excerpts ${report.privacy.excerpts_included?'included':'not included'}; redaction ${report.privacy.redaction_applied?'applied':'not applied'}. This report is not safe to share automatically; inspect it before sharing.`;
    const limitationCounts=new Map<string,number>();
    report.coverage.limitations.forEach(item=>limitationCounts.set(item,(limitationCounts.get(item)??0)+1));
    byId('coverage-banner').textContent=`Coverage: ${report.coverage.usage} usage · ${report.report.status} report · ${limitationCounts.size} limitation type(s) (${report.coverage.limitations.length} occurrences)`;
    const coverage=clear('coverage-details');
    for(const [item,count] of limitationCounts) line(coverage,'li',count===1?item:`${item} · ${count} occurrences`);
    if (!report.coverage.limitations.length) line(coverage,'li','No limitations reported. This does not verify outcomes.');
    const summary=clear('summary');
    for (const [title,value] of [['Sessions',report.summary.session_count],['Tool calls',report.summary.tool_call_count],['Observations',report.summary.finding_count],['Input tokens',report.summary.input_tokens],['Output tokens',report.summary.output_tokens],['Total tokens',report.summary.total_tokens]] as Array<[string, number | null]>) {
      const card=line(summary,'div',undefined,'summary-card');
      line(card,'span',title,'eyebrow'); line(card,'strong',formatNumber(value));
    }
    const workspace=workspaceFor(doc);
    const feedbackKey=reportFingerprint(report);
    let feedbackMap=feedbackFiles.get(doc);if(!feedbackMap){feedbackMap=new Map();feedbackFiles.set(doc,feedbackMap);}
    const feedbackForReport=()=>feedbackMap!.get(feedbackKey)??createFeedback(report);
    const sourcePanel=byId('source-inspector');
    const sourceFile=byId('source-file') as HTMLInputElement;
    const sourceUpload=byId('source-upload');
    const hasSource=(session:ReportSession)=>workspace.sources.has(session.id) || report===demoReport;
    function sourceHelp(parent:HTMLElement,session:ReportSession) {
      if(!['claude_code','codex'].includes(session.agent))return;
      const help=line(parent,'div',undefined,'source-help');
      line(help,'h4','Find this session');
      const id=session.id.slice(session.id.indexOf(':')+1),claude=session.agent==='claude_code';
      const value=claude?id+'.jsonl':id;
      line(help,'p',claude?'Expected filename:':'Session ID (look for a rollout filename containing this ID):');
      line(help,'code',value);
      copyButton(doc!,help,value,claude?'Copy filename':'Copy session ID');
      pathGuide(doc!,help,session.agent);
      line(help,'p',claude?'Open your project folder and select the expected filename, or use Choose session folder to match logs automatically.':'Choose a date folder to match logs automatically.');
      line(help,'p','Matching uses the identity inside the file.','muted');
    }
    let sourceSelection: {sessionId: string; targets: ClaudeSourceTarget[]} | null=null;
    let sourceRead=0;
    sourcePanel.hidden=true;
    sourceUpload.hidden=false;
    sourceFile.value='';
    clear('source-view');clear('source-status');
    const inspectFile=async (file?: File | SourceFile) => {
      if (!file || !sourceSelection) return;
      const selection=sourceSelection,read=++sourceRead;
      const active=()=>!sourcePanel.hidden && sourceSelection===selection && read===sourceRead && reportGenerations.get(doc)===generation;
      clear('source-view');
      try {
        if (file.size > MAX_FILE_BYTES) throw new Error('Source log exceeds the 20 MiB import limit.');
        const text=typeof file.text==='string'?file.text:await file.text();
        if(!active())return;
        const inspect=selection.sessionId.startsWith('codex:')?inspectCodexLog:inspectClaudeLog;
        const entries=inspect(text,selection.sessionId,selection.targets,file.size);
        sourceUpload.hidden=true;
        byId('source-help').hidden=true;
        byId('source-status').textContent=`Showing ${file.name || 'selected file'} locally · ${selection.sessionId}. Nothing was uploaded.`;
        if(typeof file.text!=='string') {
          workspace.sources.set(selection.sessionId,{name:file.name || 'Session log',text,size:file.size,sessionId:selection.sessionId});
          workspace.refresh?.();
          sourceFile.value='';
        }
        const view=byId('source-view');
        for(const entry of entries) {
          line(view,'h4',entry.title);
          line(view,'pre',entry.content,'source-content');
          if(entry.truncated) line(view,'p','Preview truncated (tool entries: 100,000 characters; surrounding context: 4,000). Inspect the original JSONL for the remainder.','muted');
        }
      } catch (cause) {
        if(!active())return;
        sourceFile.value='';
        sourceUpload.hidden=false;
        byId('source-help').hidden=false;
        byId('source-status').textContent=cause instanceof Error?cause.message:'Unable to read selected source log.';
      }
    };
    sourceFile.onchange=event=>{
      const files=Array.from((event.target as HTMLInputElement).files??[]);
      if(workspace.refresh) {
        void workspaceImports.get(doc)?.(files).then(()=>{sourceFile.value='';return inspectFile(sourceSelection?workspace.sources.get(sourceSelection.sessionId):undefined);});
      } else void inspectFile(files[0]);
    };
    byId('source-close').onclick=()=>{sourcePanel.hidden=true;sourceSelection=null;sourceFile.value='';clear('source-view');};
    let selected: string | null=null;
    function paintInspector(session?: ReportSession) {
      const box=clear('inspector');
      if (!session) {line(box,'p','Select a session to inspect its timeline.','empty');return;}
      line(box,'h3',session.id);
      if(['claude_code','codex'].includes(session.agent)) {
        line(box,'p',hasSource(session)?'Log attached':'Log missing','source-availability');
        if(!hasSource(session))sourceHelp(box,session);
      } else line(box,'p','Source inspection unavailable for this agent.','muted');
      line(box,'p',`${session.agent} · ${session.agent_version || 'Version unavailable'}`,'muted');
      line(box,'p',`${session.started_at || 'Start unavailable'} → ${session.ended_at || 'End unavailable'}`);
      line(box,'p',`Parent: ${session.parent_id || 'None reported'} · Relationship: ${session.relationship || 'Unavailable'}`);
      line(box,'p',`Usage: ${session.coverage.usage}; tools: ${session.coverage.tools}; input ${formatNumber(session.usage.input_tokens)}, output ${formatNumber(session.usage.output_tokens)}, total ${formatNumber(session.usage.total_tokens)}`);
      line(box,'p',`Cache read ${formatNumber(session.usage.cache_read_tokens)} · cache write ${formatNumber(session.usage.cache_write_tokens)} · reasoning ${formatNumber(session.usage.reasoning_tokens)}`);
      line(box,'p',`Calls ${session.metrics.tool_call_count} · observed errors ${session.metrics.tool_error_count} (${session.coverage.observations?.errors??'coverage unknown'}) · confirmed skill loads ${session.metrics.skill_load_count} (${session.coverage.observations?.skill_loads??'coverage unknown'}) · events ${session.metrics.event_count}`);
      session.coverage.limitations.forEach(item=>line(box,'p',`Limitation: ${item}`,'muted'));
      line(box,'h4','Models observed');
      const models=new Set(session.model_runs.filter(run=>run.model).map(run=>`${run.provider || 'Provider unavailable'} / ${run.model}`));
      models.forEach(model=>line(box,'p',model));
      if (!models.size) line(box,'p','Model not reported.','muted');
      for(const episode of report.episodes??[]) if(episode.session_id===session.id) {
        line(box,'h4','Task episode '+episode.id);line(box,'p',`Outcome: ${episode.outcome.state} (${episode.outcome.basis}); criteria: ${episode.outcome.criteria??'unassessed'}`);
        line(box,'p',`Actions: ${episode.action_evidence_ids.length} · possible corrections: ${episode.correction_evidence_ids.length} · verification references: ${episode.verification_evidence_ids.length}`);
        episode.limitations.forEach(note=>line(box,'p',note,'muted'));line(box,'p','Evidence: '+episode.evidence_ids.join(', '));
      }
      line(box,'h4','Timeline');
      const timeline=line(box,'ol',undefined,'timeline');
      session.timeline.forEach(event=>line(timeline,'li',`${event.timestamp || 'Time unavailable'} · ${event.type}${event.tool_name ? ' · '+event.tool_name : ''} · ${event.event_id} · ${event.source_ref}`));
      placeholder(timeline,'No timeline events reported.');
    }
    function feedbackForm(parent:HTMLElement,rec:Recommendation) {
      const panel=line(parent,'details',undefined,'feedback-panel');line(panel,'summary','Record local feedback');
      const status=line(panel,'p',undefined,'muted feedback-status');status.setAttribute('role','status');
      const show=()=>{const entries=feedbackMap!.get(feedbackKey)?.entries.filter(e=>e.recommendation_id===rec.id)??[];status.textContent=entries.length?entries.map(e=>`${e.reviewer}: ${e.review.decision}; usefulness ${e.review.usefulness??'unknown'}; ${e.attempt.state}; follow-up ${e.follow_up?.outcome??'missing'} — ${e.review.reason}`).join('\n'):'Unreviewed. Acceptance, implementation and improvement are separate.';};show();
      const group=(parent:HTMLElement,title:string)=>{const fields=line(parent,'fieldset',undefined,'feedback-grid');line(fields,'legend',title);return fields;};
      let fields=group(panel,'Review');
      const input=(title:string,value='',wide=false)=>{const label=line(fields,'label',undefined,'feedback-field'+(wide?' feedback-wide':''));line(label,'span',title);const field=line(label,'textarea') as HTMLTextAreaElement;field.rows=wide?3:1;field.value=value;return field;};
      const select=(title:string,options:string[])=>{const label=line(fields,'label',undefined,'feedback-field');line(label,'span',title);const field=line(label,'select') as HTMLSelectElement;options.forEach(value=>{const option=line(field,'option',value.replaceAll('_',' ').replace(/^./,char=>char.toUpperCase())) as HTMLOptionElement;option.value=value;});field.value=options[0]!;return field;};
      const reviewer=input('Reviewer (anonymous allowed)','anonymous'),decision=select('Decision',['defer','accept','reject']),sufficient=select('Evidence sufficient',['unknown','yes','no']),correct=select('Factually correct',['unknown','yes','no']),rating=select('Usefulness',['unknown','1','2','3','4','5']),reason=input('Reason','',true);
      fields=group(panel,'Implementation');
      const attempted=select('Intervention attempt',['not_attempted','attempted','unknown']),change=input('What changed','',true),test=input('Correctness test','',true);
      const followup=line(panel,'details',undefined,'feedback-followup');line(followup,'summary','Follow-up · optional');line(followup,'p','Fill this in after trying the suggestion.','muted');fields=group(followup,'Outcome');
      const outcome=select('Follow-up outcome',['missing','unknown','improved','unchanged','worse']),basis=select('Follow-up evidence basis',['user_report','observed_test','model_inference']),correctness=select('Follow-up correctness',['unknown','preserved','regression']),regressions=input('Regressions','',true),effort=input('Additional effort','',true),refs=input('Follow-up evidence IDs (comma separated)','',true);
      const actions=line(panel,'div',undefined,'feedback-actions');const save=line(actions,'button','Save feedback in this workspace','primary');save.setAttribute('type','button');line(actions,'span','Export your feedback file to keep it after closing this page.','muted');
      save.onclick=()=>{try{
        const file=feedbackForReport(),entry=feedbackDraft(report,rec.id);
        const prior=file.entries.filter(e=>e.recommendation_id===rec.id&&e.reviewer===reviewer.value).at(-1);entry.supersedes=prior?.id??null;entry.reviewer=reviewer.value||'anonymous';
        entry.review={decision:decision.value as FeedbackEntry['review']['decision'],evidence_sufficient:sufficient.value==='unknown'?null:sufficient.value==='yes',correct:correct.value==='unknown'?null:correct.value==='yes',usefulness:rating.value==='unknown'?null:Number(rating.value),reason:reason.value};
        entry.attempt={state:attempted.value as FeedbackEntry['attempt']['state'],change:change.value,correctness_test:test.value};
        if(outcome.value!=='missing')entry.follow_up={outcome:outcome.value as NonNullable<FeedbackEntry['follow_up']>['outcome'],basis:basis.value as NonNullable<FeedbackEntry['follow_up']>['basis'],correctness:correctness.value as NonNullable<FeedbackEntry['follow_up']>['correctness'],regressions:regressions.value,additional_effort:effort.value,evidence_ids:refs.value.split(',').map(id=>id.trim()).filter(Boolean)};
        feedbackMap!.set(feedbackKey,appendFeedback(report,file,entry));show();
      }catch(error){status.textContent=error instanceof Error?error.message:'Unable to save feedback';}};
    }
    function paintScope() {
      const filtered=selectScope(report,(byId('agent-filter') as HTMLSelectElement).value);
      byId('session-count').textContent=`(${filtered.sessions.length})`;
      const body=clear('sessions-body');
      filtered.sessions.forEach(session=> {
        const tr=node('tr'); body.append(tr);
        const first=line(tr,'td');
        const button=line(first,'button',`${session.id} · ${session.agent}`,'session-link');
        line(first,'small',['claude_code','codex'].includes(session.agent)?hasSource(session)?'Log attached':'Log missing':'Source inspection unavailable','source-availability');
        button.setAttribute('type','button'); button.addEventListener('click',()=>{selected=session.id;paintInspector(session);});
        line(tr,'td',session.coverage.usage);
        line(tr,'td',formatNumber(session.usage.total_tokens),'numeric');
        line(tr,'td',formatNumber(session.metrics.tool_call_count),'numeric');
        line(tr,'td',formatNumber(session.metrics.tool_error_count)+' observed ('+(session.coverage.observations?.errors??'coverage unknown')+')','numeric');
      });
      byId('no-sessions').hidden=filtered.sessions.length!==0;
      paintInspector(filtered.sessions.find(session=>session.id===selected));
      const findingGroups=new Map<string,Finding[]>();
      filtered.findings.forEach(finding=>{
        const key=JSON.stringify([finding.rule_id,finding.category,finding.title,finding.severity,finding.claim_type,finding.confidence,finding.interpretation]);
        const group=findingGroups.get(key)??[];group.push(finding);findingGroups.set(key,group);
      });
      const reviewGroups=[...findingGroups.values()].filter(group=>!activityRules.has(group[0]!.rule_id));
      const activityGroups=[...findingGroups.values()].filter(group=>activityRules.has(group[0]!.rule_id));
      const groupCount=(groups:Finding[][])=>{const total=groups.reduce((n,group)=>n+group.length,0);return `(${groups.length} ${groups.length===1?'type':'types'} · ${total} ${total===1?'observation':'observations'})`;};
      byId('finding-count').textContent=groupCount(reviewGroups);
      byId('activity-count').textContent=groupCount(activityGroups);
      const evidence=new Map(report.evidence.map(item=>[item.id,item]));
      const sessions=new Map(report.sessions.map(session=>[session.id,session]));
      const findings=clear('findings');
      const activity=clear('activity');
      function paintFinding(parent:HTMLElement,finding:Finding) {
        line(parent,'p',finding.observation);
        const details=line(parent,'details');line(details,'summary',`Evidence (${finding.evidence_ids.length})`);
        finding.evidence_ids.forEach(id=>{
          const e=evidence.get(id);
          line(details,'p',e ? `${e.session_id} · ${e.event_id} · ${e.source_ref}: ${e.description}` : `Evidence ${id} unavailable`);
          if (e && e.excerpt !== null) line(details,'pre',e.excerpt,'excerpt');
          const session=e && sessions.get(e.session_id);
          const event=session?.timeline.find(item=>item.event_id===e?.event_id && item.source_ref===e?.source_ref);
          if (e && session && ['claude_code','codex'].includes(session.agent) && /^line:[1-9]\d*$/.test(e.source_ref) && event && sourceTypes.has(event.type)) {
            const button=line(details,'button','Inspect source','source-link');
            button.setAttribute('type','button');
            button.addEventListener('click',()=>{
              const related=finding.evidence_ids.length<=40?finding.evidence_ids.map(item=>evidence.get(item)).filter(item=>item?.session_id===e.session_id):[e];
              const targets=related.flatMap(item=>{
                const hit=session.timeline.find(row=>row.event_id===item?.event_id && row.source_ref===item?.source_ref);
                return item && hit && sourceTypes.has(hit.type)?[{source_ref:item.source_ref,type:hit.type as ClaudeSourceTarget['type']}]:[];
              });
              sourceSelection={sessionId:e.session_id,targets};
              sourcePanel.hidden=false;
              sourceUpload.hidden=false;
              const help=clear('source-help');help.hidden=false;sourceHelp(help,session);
              clear('source-view');
              byId('source-status').textContent=`Choose the matching ${session.agent==='codex'?'Codex rollout':'Claude Code'} JSONL for ${e.session_id} to inspect ${targets.map(item=>item.source_ref).join(' and ')}. The report does not contain the raw log.`;
              sourcePanel.scrollIntoView?.({block:'start'});
              void inspectFile(workspace.sources.get(e.session_id) ?? (report===demoReport ? new File([demoSource],'codex-pages-session.jsonl') : undefined));
            });
          }
        });
      }
      [...findingGroups.values()].sort((a,b)=>b.length-a.length).forEach(group=>{
        const finding=group[0]!;
        const ordinary=activityRules.has(finding.rule_id);
        const card=line(ordinary?activity:findings,'article',undefined,'card');
        line(card,'h3',`${finding.title} · ${group.length} ${group.length===1?'occurrence':'occurrences'}`);
        line(card,'p',ordinary?'Activity only — not an improvement recommendation.':'Review candidate — usefulness requires context.','muted');
        line(card,'p',finding.interpretation);
        const reviewActions=report.recommendations.filter(rec=>rec.kind==='investigate' && rec.finding_ids.some(id=>group.some(item=>item.id===id)));
        if(!ordinary) [...new Set(reviewActions.map(rec=>rec.action))].forEach(action=>line(card,'p',`Review question: ${action}`));
        if(group.length===1) paintFinding(card,finding);
        else {
          const details=line(card,'details');line(details,'summary',`Inspect ${group.length} observations and evidence`);
          group.forEach(item=>{
            const occurrence=line(details,'div',undefined,'occurrence');
            line(occurrence,'p',item.session_ids.join(', '),'muted');
            paintFinding(occurrence,item);
          });
        }
      });
      placeholder(findings,'No review candidates identified for this scope.');
      placeholder(activity,'No size or standalone error observations for this scope. The session timeline contains all observed events.');
      const recommendationIds=new Set(filtered.findings.map(f=>f.id));
      const recs=clear('recommendations');
      const recommendationGroups=new Map<string,Recommendation[]>();
      report.recommendations.filter(rec=>rec.kind!=='investigate' && rec.finding_ids.some(id=>{
        const finding=filtered.findings.find(item=>item.id===id);
        return finding && !reviewOnlyRules.has(finding.rule_id) && finding.evidence_ids.length>0;
      }) && ((byId('agent-filter') as HTMLSelectElement).value==='all' || rec.finding_ids.some(id=>recommendationIds.has(id)))).forEach(rec=>{
        const key=rec.overlap_group===null?rec.id:JSON.stringify([rec.overlap_group,rec.title,rec.action,rec.kind,rec.priority]);
        const group=recommendationGroups.get(key)??[];group.push(rec);recommendationGroups.set(key,group);
      });
      [...recommendationGroups.values()].sort((a,b)=>b.length-a.length).forEach(group=>{
        const rec=group[0]!;
        const card=line(recs,'article',undefined,'card'); line(card,'h3',rec.title);
        line(card,'p',`${rec.kind} · ${rec.priority} priority · ${group.length} ${group.length===1?'occurrence':'occurrences'}`,'muted');
        line(card,'p',rec.action);
        const linked=filtered.findings.filter(item=>group.some(rec=>rec.finding_ids.includes(item.id)));
        const support=line(card,'details');line(support,'summary','Why this is suggested · evidence');
        linked.forEach(finding=>paintFinding(support,finding));
        group.forEach(item=>feedbackForm(card,item));
        if(group.length>1){
          const details=line(card,'details');line(details,'summary',`Linked findings (${group.length})`);
          group.forEach(item=>line(details,'p',`${item.id} · ${item.finding_ids.join(', ')}`));
        }
      });
      byId('suggestion-count').textContent=`(${recommendationGroups.size})`;
      placeholder(recs,'No actionable improvements identified. Activity and review candidates below are not proof of wasted work.');
      const candidates=clear('candidates');
      filtered.candidates.forEach(candidate=>{
        const card=line(candidates,'article',undefined,'card'); line(card,'h3',candidate.title);
        line(card,'p',`Proposed: ${candidate.recommendation} · ${candidate.trigger}`,'muted');
        line(card,'p',candidate.rationale);
        line(card,'p',`Evidence: ${candidate.evidence_ids.join(', ') || 'None reported'}`);
        const tests=line(card,'ul');candidate.acceptance_tests.forEach(item=>line(tests,'li',item));
      });
      placeholder(candidates,'No skill candidates for this agent.');
    }
    function table<T>(id: string, columns: string[], data: T[], values: (item: T) => string[]) {
      const holder=clear(id);
      if (!data.length) {placeholder(holder,'No observations reported.');return;}
      const t=line(holder,'table'),thead=line(t,'thead'),head=line(thead,'tr');
      columns.forEach(col=>line(head,'th',col));
      const tbody=line(t,'tbody');
      data.forEach(row=>{const tr=line(tbody,'tr');values(row).forEach(val=>line(tr,'td',val));});
    }
    table('tools',['Tool','Calls','Observed errors (may be partial)','Output characters'],report.metrics.tools,t=>[t.name,formatNumber(t.calls),formatNumber(t.errors),formatNumber(t.output_chars)]);
    table('skills',['Skill','Confirmed loads (may be partial)','States'],report.metrics.skills,s=>[s.name,formatNumber(s.loads),s.states.join(', ') || 'Unknown']);
    const notes=clear('analysis-notes');
    line(notes,'p',`Analysis: ${report.analysis_usage.mode} · model tokens: ${formatNumber(report.analysis_usage.model_tokens)}`);
    report.analysis_usage.notes.forEach(note=>line(notes,'p',note));
    const feedbackPanel=line(notes,'details');line(feedbackPanel,'summary','Local feedback files');
    line(feedbackPanel,'p','Feedback stays in memory until you explicitly export it. Import requires the same report and recommendation fingerprints.');
    const feedbackStatus=line(feedbackPanel,'p');
    const exportFeedback=line(feedbackPanel,'button','Export feedback JSON');exportFeedback.setAttribute('type','button');
    exportFeedback.onclick=()=>{try{const file=feedbackForReport();validateFeedback(report,file);const link=line(feedbackPanel,'a','Download feedback.json') as HTMLAnchorElement;link.href='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(file,null,2));link.download='feedback.json';feedbackStatus.textContent='Use the download link to save feedback locally.';}catch(error){feedbackStatus.textContent=error instanceof Error?error.message:'Unable to export feedback';}};
    const importLabel=line(feedbackPanel,'label','Import feedback JSON');const importFeedback=line(importLabel,'input') as HTMLInputElement;importFeedback.type='file';importFeedback.accept='.json,application/json';
    importFeedback.onchange=async()=>{try{const file=importFeedback.files?.[0];if(!file)return;if(file.size>MAX_FILE_BYTES)throw new Error('Feedback exceeds 20 MiB');const value:unknown=JSON.parse(await file.text());if(reportGenerations.get(doc!)!==generation)return;validateFeedback(report,value);
      const current=feedbackForReport(),ids=new Map(current.entries.map(e=>[e.id,e]));let merged=current;
      for(const entry of value.entries){const existing=ids.get(entry.id);if(existing){if(JSON.stringify(existing)!==JSON.stringify(entry))throw new Error('Conflicting feedback ID');continue;}merged=appendFeedback(report,merged,entry);ids.set(entry.id,entry);}
      feedbackMap!.set(feedbackKey,merged);paintScope();feedbackStatus.textContent=`Imported ${value.entries.length} feedback records.`;
    }catch(error){feedbackStatus.textContent=error instanceof Error?error.message:'Unable to import feedback';}};
    (byId('agent-filter') as HTMLSelectElement).onchange=paintScope;
    workspace.sourcesChanged=()=>{
      if(reportGenerations.get(doc!)!==generation)return;
      paintScope();
      if(sourceSelection) {
        const session=report.sessions.find(item=>item.id===sourceSelection?.sessionId);
        const help=clear('source-help');
        if(session)sourceHelp(help,session);
      }
      if(sourceSelection && !sourcePanel.hidden)void inspectFile(workspace.sources.get(sourceSelection.sessionId));
    };
    paintScope();
    return report;
  }
  const workspaceImports=new WeakMap<Document,(files:File[])=>Promise<void>>();
  export function bootstrap(doc: Document | undefined = root?.document): void {
    if (!doc) return;
    // Data downloads also work in a standalone exported HTML report.
    for(const [id,mime,content] of [['demo-report-download','application/json',JSON.stringify(demoData,null,2)+'\n'],['demo-session-download','application/x-ndjson',demoSource]]) {
      doc.getElementById(id!)?.setAttribute('href',`data:${mime};charset=utf-8,${encodeURIComponent(content!)}`);
    }
    const get = (id: string): HTMLElement => { const el = doc.getElementById(id); if (!el) throw new Error(`Missing viewer element: ${id}`); return el; };
    const error = (message: string) => { get('import-error').textContent=message;get('import-error').hidden=false; };
    const workspace=workspaceFor(doc);
    const selector=get('platform-select') as HTMLSelectElement;
    selector.value=currentPlatform(doc);
    const updateGuide=()=>{const guide=get('session-path-guide');guide.replaceChildren();pathGuide(doc,guide);};
    selector.onchange=()=>{
      if(['mac','windows','linux','unknown'].includes(selector.value))platformChoices.set(doc,selector.value as Platform);
      updateGuide();workspace.sourcesChanged?.();
    };
    updateGuide();
    const hideReport=()=>{
      reportGenerations.set(doc,(reportGenerations.get(doc)??0)+1);
      get('report-view').hidden=true;get('empty-state').hidden=false;
      get('source-view').replaceChildren();get('source-inspector').hidden=true;
      (get('source-file') as HTMLInputElement).value='';
      workspace.sourcesChanged=undefined;
    };
    const activate=(id:number)=>{
      const entry=workspace.reports.find(item=>item.id===id);
      if(!entry)return;
      workspace.active=id;
      (get('agent-filter') as HTMLSelectElement).value='all';
      renderReport(entry.report,doc);refresh();
    };
    const removeReport=(id:number)=>{
      workspace.reports=workspace.reports.filter(item=>item.id!==id);
      if(workspace.active===id) {
        workspace.active=null;
        if(workspace.reports.length)activate(workspace.reports[0]!.id);else hideReport();
      }
      refresh();
    };
    const refresh=()=>{
      get('workspace-files').hidden=workspace.reports.length+workspace.sources.size===0;
      get('workspace-count').textContent=`(${workspace.reports.length} reports · ${workspace.sources.size} session logs)`;
      const list=get('workspace-list');list.replaceChildren();
      const row=(name:string,description:string,remove:()=>void,open?:()=>void,active=false)=>{
        const item=doc.createElement('div');item.className='workspace-file';
        const title=doc.createElement(open?'button':'span');title.textContent=name;
        title.className='workspace-file-name';
        if(open){title.setAttribute('type','button');title.setAttribute('aria-pressed',String(active));title.onclick=open;}
        const detail=doc.createElement('span');detail.className='muted';detail.textContent=description;
        const button=doc.createElement('button');button.textContent='Remove';button.setAttribute('type','button');button.setAttribute('aria-label',`Remove ${name}`);button.onclick=remove;
        item.append(title,detail,button);list.append(item);
      };
      workspace.reports.forEach(entry=>row(entry.name,`${entry.report.sessions.length} sessions${entry.id===workspace.active?' · Active report':''}`,()=>removeReport(entry.id),()=>activate(entry.id),entry.id===workspace.active));
      workspace.sources.forEach(source=>row(source.name,source.sessionId,()=>{
        workspace.sources.delete(source.sessionId);
        get('source-close').click?.();
        get('source-view').replaceChildren();get('source-inspector').hidden=true;
        refresh();workspace.sourcesChanged?.();
      }));
    };
    workspace.refresh=refresh;
    const addReport=(report:Report,name:string)=>{
      const existing=workspace.reports.find(entry=>entry.name===name && JSON.stringify(entry.report)===JSON.stringify(report));
      if(existing)return existing.id;
      const id=++workspace.nextId;workspace.reports.push({id,name,report});return id;
    };
    let importQueue=Promise.resolve();
    const readFiles=(files:File[],folder=false):Promise<void>=>{
      const epoch=workspace.epoch;
      importQueue=importQueue.then(async()=>{
        const errors:string[]=[];let firstReport:number|undefined;
        const wanted=new Set(workspace.reports.flatMap(entry=>entry.report.sessions.map(session=>session.id)));
        if(folder && !wanted.size){error('Open a report before choosing a session folder.');return;}
        let matched=0,ignored=0,unreadable=0;
        const attached=new Set<string>();
        get('import-status').textContent=folder?'Matching session logs…':'';
        for(const file of files) {
          if(workspace.epoch!==epoch)return;
          if(folder && !/\.jsonl$/i.test(file.name??'')){ignored++;continue;}
          try {
            if(file.size>MAX_FILE_BYTES)throw new Error('File exceeds the 20 MiB import limit.');
            const text=await file.text();
            if(workspace.epoch!==epoch)return;
            if(/\.jsonl$/i.test(file.name??'')) {
              if(new TextEncoder().encode(text).length>MAX_FILE_BYTES)throw new Error('File exceeds the 20 MiB import limit.');
              const sessionId=sourceSessionId(text);
              if(folder && (!wanted.has(sessionId) || attached.has(sessionId))){ignored++;continue;}
              attached.add(sessionId);matched++;
              workspace.sources.set(sessionId,{name:file.name,text,size:file.size,sessionId});
            } else {
              const id=addReport(parseReport(text,file.size),file.name || 'Report');
              firstReport??=id;
            }
          } catch(cause){if(folder)unreadable++;else errors.push(`${file.name || 'File'}: ${cause instanceof Error?cause.message:'Unable to read file.'}`);}
        }
        if(firstReport!==undefined)activate(firstReport);
        refresh();workspace.sourcesChanged?.();get('import-error').hidden=!errors.length;
        if(folder)get('import-status').textContent=`Attached ${matched} matching log(s). ${ignored} unrelated / duplicate file(s) ignored; ${unreadable} invalid or oversized file(s) skipped.`;
        if(errors.length)error(errors.join('\n'));
      });
      return importQueue;
    };
    workspaceImports.set(doc,readFiles);
    const embedded=get('embedded-report');
    if(embedded.textContent.trim()) {
      try {activate(addReport(parseReport(embedded.textContent),'Embedded report'));}
      catch(cause){error(cause instanceof Error?cause.message:'Unable to open report.');}
    }
    get('clear-button').addEventListener('click',()=>{if(workspace.active!==null)removeReport(workspace.active);});
    get('workspace-clear').addEventListener('click',()=>{feedbackFiles.delete(doc!);
      workspace.epoch++;workspace.reports=[];workspace.sources.clear();workspace.active=null;
      hideReport();refresh();get('import-error').hidden=true;get('import-status').textContent='';
      (get('report-file') as HTMLInputElement).value='';
    });
    get('report-file').addEventListener('change',event=>{
      const input=event.target as HTMLInputElement;
      void readFiles(Array.from(input.files??[]));input.value='';
    });
    get('session-folder').addEventListener('change',event=>{
      const input=event.target as HTMLInputElement;
      void readFiles(Array.from(input.files??[]),true);input.value='';
    });
    const zone=get('drop-zone');
    zone.addEventListener('dragover',event=>{event.preventDefault();zone.classList.add('dragover');});
    zone.addEventListener('dragleave',()=>zone.classList.remove('dragover'));
    zone.addEventListener('drop',event=>{
      event.preventDefault();zone.classList.remove('dragover');
      void readFiles(Array.from((event as DragEvent).dataTransfer?.files??[]));
    });
    get('demo-button').addEventListener('click',()=>{activate(addReport(demoReport,'Real session demo'));});
    refresh();
  }

  const api = {validateReport, parseReport, inspectClaudeLog, inspectCodexLog, selectScope, formatNumber, renderReport, bootstrap, detectPlatform, MAX_FILE_BYTES};
  
  if (root) {
    (root as Window & {SessionAnalysis?: typeof api}).SessionAnalysis = api;
    if (root.document) {
      if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded',()=>bootstrap(root.document));
      else bootstrap(root.document);
    }
  }
