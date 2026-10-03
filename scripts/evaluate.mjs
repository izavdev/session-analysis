import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {cases} from '../evaluations/cases.mjs';
import {analyze,evidencePacket,mergeInterpretation} from '../dist/core.js';
const hash = value => createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export function prepare() {
  const skill=readFileSync(new URL('../skills/session-analysis/SKILL.md',import.meta.url),'utf8');
  const guide=readFileSync(new URL('../skills/session-analysis/references/interpretation.md',import.meta.url),'utf8');
  return {format_version:1,revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),skill_sha256:hash(skill),guide_sha256:hash(guide),packet_policy:{max_chars:12000,include_excerpts:false},cases:cases.map(c=>{
    const report=analyze(c.sessions);return {id:c.id,split:c.split,task:c.task,input_sha256:hash(c.sessions),packet:evidencePacket(report),report};
  })};
}
export function review(run,records) {
  if(!records || !Array.isArray(records.outputs)) throw new Error('Expected recorded outputs');
  const ids=new Set();
  const rows=records.outputs.map(output=>{
    if(ids.has(output.case_id)) throw new Error('Duplicate case output');ids.add(output.case_id);
    const c=run.cases.find(c=>c.id===output.case_id);
    if(!c || output.input_sha256!==c.input_sha256 || output.packet_sha256!==hash(c.packet)) throw new Error('Unknown case or changed input/packet');
    if(typeof output.response!=='string'||!output.response.trim()) throw new Error('Actual response required');
    const packetEvidence=new Set(c.packet.evidence.map(e=>e.id));
    for(const claim of [...(output.interpretation?.findings??[]),...(output.interpretation?.skill_candidates??[])]) {
      if(!Array.isArray(claim.evidence_ids)||claim.evidence_ids.some(id=>!packetEvidence.has(id))) throw new Error('Claim cites evidence outside supplied packet');
    }
    mergeInterpretation(c.report,output.interpretation);
    if(!Array.isArray(output.reviews)||!output.reviews.length) throw new Error('Explicit review required');
    for(const r of output.reviews) {
      if(!r.reviewer || !r.reason || !['accept','reject','defer'].includes(r.decision)) throw new Error('Review identity, decision and reason required');
      for(const k of ['grounding','contextual_correctness','actionability','usefulness']) if(!Number.isInteger(r[k])||r[k]<1||r[k]>5) throw new Error('Scores must be 1–5');
      if(typeof r.missed_opportunity!=='boolean'||!Array.isArray(r.unsupported_claims)) throw new Error('Missed opportunity and unsupported claims required');
    }
    return {case_id:c.id,reviews:output.reviews,disagreement:new Set(output.reviews.map(r=>JSON.stringify([r.decision,r.grounding,r.contextual_correctness,r.actionability,r.usefulness,r.missed_opportunity]))).size>1};
  });
  if(!records.model || !records.review_method || records.skill_sha256!==run.skill_sha256||records.guide_sha256!==run.guide_sha256||records.revision!==run.revision) throw new Error('Matching execution provenance required');
  return {reviewed:rows.length,unreviewed:run.cases.filter(c=>!ids.has(c.id)).map(c=>c.id),review_method:records.review_method,rows};
}
if(process.argv[1]===new URL(import.meta.url).pathname) {
  const [command,path,out]=process.argv.slice(2);
  if(command==='prepare' && path) {mkdirSync(path,{recursive:true});writeFileSync(`${path}/run.json`,JSON.stringify(prepare(),null,2));}
  else if(command==='review' && path && out) console.log(JSON.stringify(review(JSON.parse(readFileSync(path,'utf8')),JSON.parse(readFileSync(out,'utf8'))),null,2));
  else throw new Error('Usage: node scripts/evaluate.mjs prepare DIRECTORY | review RUN.json OUTPUTS.json');
}
export {hash};
