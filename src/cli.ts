#!/usr/bin/env node
import {existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyzeFeedback,compareTrial} from './feedback-analysis.js';
import type {ReviewedSample,Trial} from './feedback-analysis.js';
import {createFeedback,feedbackDraft,appendFeedback,validateFeedback} from './feedback.js';
import type {FeedbackFile,FeedbackEntry} from './feedback.js';
import {reviewOutcome} from './episodes.js';
import {BUILD} from './build-info.js';
import type {InterpretationProvenance} from './types.js';
import {discover, loadSessions} from './adapters.js';
import {analyze, evidencePacket, mergeInterpretation, selectContext} from './core.js';
import {renderHtml} from './export.js';
import {validateReport} from './validation.js';
import type {AgentName} from './types.js';

const HELP = `Session Analysis — local-first diagnostics (no network or model calls)
Usage: session-analysis <command> [options]
Commands: discover, analyze, validate, packet, context, outcome, feedback-template, feedback-add, feedback-validate, feedback-export, feedback-analyze, trial, merge, export
  discover [--agent all|claude_code|codex|hermes] [--root DIRECTORY]
  analyze FILE_OR_DIR... -o REPORT.json [--agent auto|claude_code|codex|hermes] [--session-id AGENT:ID] [--include-excerpts]
  validate REPORT.json
  packet REPORT.json -o PACKET.json [--max-chars 12000]
  context REPORT.json SOURCE --event-id AGENT:SESSION:EVENT -o CONTEXT.json [--include-excerpts]
  feedback-analyze SELECTED_SAMPLES.json -o SUMMARY.json
  trial BASELINE.json FOLLOWUP.json TRIAL.json -o COMPARISON.json
  feedback-template REPORT.json -o FEEDBACK.json [--recommendation-id ID]
  feedback-add REPORT.json FEEDBACK.json ENTRY.json -o UPDATED.json
  feedback-validate REPORT.json FEEDBACK.json
  feedback-export REPORT.json FEEDBACK.json -o COPY.json
  outcome CONTEXT.json REVIEW.json -o REVIEWED.json
  merge REPORT.json INTERPRETATION.json -o ASSISTED.json
  export REPORT.json -o REPORT.html
`;

interface Parsed {positionals: string[]; options: Map<string, string[]>; switches: Set<string>}
function parse(rest: string[]): Parsed {
  const result: Parsed = {positionals: [], options: new Map(), switches: new Set()};
  const valued = new Set(['-o', '--output', '--agent', '--root', '--session-id', '--max-chars', '--event-id', '--finding-id','--interpretation-metadata','--recommendation-id']);
  for (let i = 0; i < rest.length; i++) {
    const part = rest[i]!;
    if (valued.has(part)) {
      const value = rest[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${part}`);
      const key = part === '-o' ? '--output' : part;
      result.options.set(key, [...(result.options.get(key) ?? []), value]);
    } else if (part === '--include-excerpts') result.switches.add(part);
    else if (part.startsWith('-')) throw new Error(`Unknown option ${part}`);
    else result.positionals.push(part);
  }
  return result;
}
function option(parsed: Parsed, name: string, fallback?: string): string | undefined {
  const values = parsed.options.get(name);
  if (values && values.length !== 1) throw new Error(`${name} must be supplied once`);
  return values?.[0] ?? fallback;
}
function output(parsed: Parsed): string {
  const value = option(parsed, '--output');
  if (!value) throw new Error('Missing required -o/--output');
  return value;
}
function readJson(path: string): unknown {
  if (statSync(path).size > 20 * 1024 * 1024) throw new Error('Report exceeds the 20 MiB limit');
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error('Invalid JSON'); }
}
function canonical(path: string): string {
  const absolute = resolve(path);
  if (existsSync(absolute)) return realpathSync(absolute);
  let ancestor = dirname(absolute);
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  return resolve(realpathSync(ancestor), relative(ancestor, absolute));
}
function ensureDistinct(target: string, inputs: string[], includeDirectories = false): void {
  const dest = canonical(target);
  for (const path of inputs) {
    const source = canonical(path);
    if (dest === source) throw new Error('Refusing to overwrite input file');
    if (includeDirectories && existsSync(path) && statSync(path).isDirectory()) {
      const inside = relative(source, dest);
      if (inside === '' || (inside !== '..' && !inside.startsWith('..' + sep) && !isAbsolute(inside))) {
        throw new Error('Refusing to write report inside an input directory');
      }
    }
  }
}
function writeOutput(path: string, value: unknown, compact = false): void {
  mkdirSync(dirname(resolve(path)), {recursive: true});
  const text = typeof value === 'string' ? value : compact ? JSON.stringify(value) : JSON.stringify(value, null, 2) + '\n';
  writeFileSync(path, text, 'utf8');
  console.log(`Written: ${path}`);
}
function agent(value: string | undefined, allowAll: boolean): AgentName | 'all' | 'auto' {
  const allowed = allowAll ? ['all', 'claude_code', 'codex', 'hermes'] : ['auto', 'claude_code', 'codex', 'hermes'];
  const selected = value ?? (allowAll ? 'all' : 'auto');
  if (!allowed.includes(selected)) throw new Error('Unsupported agent');
  return selected as AgentName | 'all' | 'auto';
}
function requireCount(items: string[], amount: number, command: string): void {
  if (items.length !== amount) throw new Error(`${command} expects ${amount} input path${amount === 1 ? '' : 's'}`);
}
export function main(argv: string[] = process.argv.slice(2)): number {
  try {
    const [command, ...args] = argv;
    if (!command || command === '--help' || command === '-h') { console.log(HELP); return 0; }
    if (command === '--version') { console.log(BUILD.version); return 0; }
    const parsed = parse(args);
    if (command === 'discover') {
      requireCount(parsed.positionals, 0, command);
      console.log(JSON.stringify(discover(agent(option(parsed, '--agent'), true) as AgentName | 'all', option(parsed, '--root')), null, 2));
    } else if (command === 'analyze') {
      if (!parsed.positionals.length) throw new Error('analyze expects selected session paths');
      const dest = output(parsed);
      ensureDistinct(dest, parsed.positionals, true);
      const selectedAgent = agent(option(parsed, '--agent'), false) as AgentName | 'auto';
      const sessions = parsed.positionals.flatMap(path => loadSessions(path, selectedAgent));
      const selectors = new Set(parsed.options.get('--session-id') ?? []);
      for (const selection of selectors) {
        if (!sessions.some(session => selection === session.id || selection === `${session.agent}:${session.id}`)) {
          throw new Error(`Session ID not found: ${selection}`);
        }
      }
      const chosen = selectors.size ? sessions.filter(session => selectors.has(session.id) || selectors.has(`${session.agent}:${session.id}`)) : sessions;
      if (!chosen.length) throw new Error('No sessions matched the selected inputs');
      const report = analyze(chosen, parsed.switches.has('--include-excerpts'));
      validateReport(report);
      writeOutput(dest, report);
    } else if(command==='feedback-analyze') {
      requireCount(parsed.positionals,1,command);const selected=readJson(parsed.positionals[0]!) as {samples:ReviewedSample[];opportunities?:Array<{id:string;found:boolean|null}>};
      if(!selected||!Array.isArray(selected.samples))throw new Error('Expected explicitly selected report/feedback samples');const dest=output(parsed);ensureDistinct(dest,parsed.positionals);writeOutput(dest,analyzeFeedback(selected.samples,selected.opportunities));
    } else if(command==='trial') {
      requireCount(parsed.positionals,3,command);const baseline=readJson(parsed.positionals[0]!);const followup=readJson(parsed.positionals[1]!);validateReport(baseline);validateReport(followup);const dest=output(parsed);ensureDistinct(dest,parsed.positionals);writeOutput(dest,compareTrial(baseline,followup,readJson(parsed.positionals[2]!) as Trial));
    } else if (command.startsWith('feedback-')) {
      const count=command==='feedback-template'?1:command==='feedback-add'?3:2;requireCount(parsed.positionals,count,command);
      const report=readJson(parsed.positionals[0]!);validateReport(report);
      let file:unknown=command==='feedback-template'?createFeedback(report):readJson(parsed.positionals[1]!);
      validateFeedback(report,file);
      if(command==='feedback-add') file=appendFeedback(report,file,readJson(parsed.positionals[2]!) as FeedbackEntry);
      if(command==='feedback-validate') console.log('Valid feedback');
      else if(['feedback-template','feedback-add','feedback-export'].includes(command)){const dest=output(parsed);ensureDistinct(dest,parsed.positionals);writeOutput(dest,command==='feedback-template'&&option(parsed,'--recommendation-id')?feedbackDraft(report,option(parsed,'--recommendation-id')!):file);}
      else throw new Error('Unknown feedback command');
    } else if (['validate', 'packet', 'context', 'outcome', 'merge', 'export'].includes(command)) {
      requireCount(parsed.positionals, ['merge','context','outcome'].includes(command) ? 2 : 1, command);
      const source = parsed.positionals[0]!;
      const dest = command === 'validate' ? undefined : output(parsed);
      if (dest) ensureDistinct(dest, parsed.positionals);
      const report = readJson(source);
      validateReport(report);
      if (command === 'validate') console.log('Valid report');
      else if (command === 'packet') {
        const limitText = option(parsed, '--max-chars', '12000')!;
        const limit = Number(limitText);
        if (!Number.isSafeInteger(limit)) throw new Error('--max-chars must be an integer');
        writeOutput(dest!, evidencePacket(report, limit, {finding_ids:parsed.options.get('--finding-id'),session_ids:parsed.options.get('--session-id')}), true);
      } else if (command === 'context') {
        const sessions=loadSessions(parsed.positionals[1]!);
        const ids=parsed.options.get('--event-id')??[];
        const matches=sessions.filter(s=>ids.every(id=>id.startsWith(s.agent+':'+s.id+':')));
        if(matches.length!==1) throw new Error('Select events from exactly one source session');
        writeOutput(dest!,selectContext(report,matches[0]!,ids,parsed.switches.has('--include-excerpts')));
      } else if (command === 'outcome') {
        writeOutput(dest!,reviewOutcome(report,readJson(parsed.positionals[1]!)));
      } else if (command === 'merge') {
        const merged = mergeInterpretation(report, readJson(parsed.positionals[1]!),option(parsed,'--interpretation-metadata')?readJson(option(parsed,'--interpretation-metadata')!) as InterpretationProvenance:undefined);
        validateReport(merged);
        writeOutput(dest!, merged);
      } else writeOutput(dest!, renderHtml(report));
    } else throw new Error(`Unknown command ${command}`);
    return 0;
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return 2;
  }
}

if (process.argv[1] && canonical(process.argv[1]) === canonical(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
