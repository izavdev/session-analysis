import type {Report,Finding,Recommendation,SkillCandidate} from './types.js';
import type {FeedbackFile} from './feedback.js';
import {validateFeedback} from './feedback.js';
import {validateReport} from './validation.js';
import {fingerprint} from './identity.js';
import {mergeInterpretation} from './core.js';
export interface WorkflowAssessment {
  id:string; title:string; trigger:string;kind:'script'|'template'|'skill';
  episode_ids:string[];evidence_ids:string[];equivalent:boolean|null;
  conditions:string;decisions:string;outputs:string;applicability:string;uncertainty:string;
  acceptance_tests:string[];existing_skill_id:string|null;
}
export interface ExistingSkill {id:string;title:string;applicability:string;source_sha256:string;}
/** Optional calling-agent grouping; no semantic guesses, discovery or installation by the toolkit. */
export function assessWorkflows(report:Report,input:unknown,feedback?:FeedbackFile,existingSkills:ExistingSkill[]=[]):Report {
  validateReport(report);if(feedback)validateFeedback(report,feedback);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!Array.isArray((input as {groups?:unknown}).groups))throw new Error('Expected selected workflow groups');
  const skillIds=new Set<string>();for(const skill of existingSkills){if(!skill||Object.keys(skill).length!==4||['id','title','applicability'].some(k=>typeof skill[k as keyof ExistingSkill]!=='string'||!skill[k as keyof ExistingSkill].trim())||typeof skill.source_sha256!=='string'||!/^[a-f0-9]{64}$/.test(skill.source_sha256)||skillIds.has(skill.id))throw new Error('Invalid explicitly selected skill metadata');skillIds.add(skill.id);}
  const keys=['id','title','trigger','kind','episode_ids','evidence_ids','equivalent','conditions','decisions','outputs','applicability','uncertainty','acceptance_tests','existing_skill_id'];
  const ids=new Set<string>(),findings:Finding[]=[],recommendations:Recommendation[]=[],skill_candidates:SkillCandidate[]=[],notes:string[]=[];
  for(const raw of (input as {groups:unknown[]}).groups){
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==keys.length||keys.some(k=>!Object.hasOwn(raw,k)))throw new Error('Invalid workflow assessment fields');
    const group=raw as WorkflowAssessment;if(ids.has(group.id))throw new Error('Duplicate workflow group');ids.add(group.id);
    for(const k of ['id','title','trigger','conditions','decisions','outputs','applicability','uncertainty'] as const)if(typeof group[k]!=='string'||!group[k].trim())throw new Error('Workflow comparison, applicability and uncertainty required');
    if(!['script','template','skill'].includes(group.kind)||![true,false,null].includes(group.equivalent)||!Array.isArray(group.episode_ids)||group.episode_ids.length<2||new Set(group.episode_ids).size!==group.episode_ids.length||!Array.isArray(group.evidence_ids)||!group.evidence_ids.length||new Set(group.evidence_ids).size!==group.evidence_ids.length||!Array.isArray(group.acceptance_tests)||!group.acceptance_tests.length||group.acceptance_tests.some(t=>typeof t!=='string'||!t.trim()))throw new Error('Workflow requires distinct selected episodes, evidence and acceptance tests');
    if(group.existing_skill_id!==null&&(!skillIds.has(group.existing_skill_id)||group.kind!=='skill'))throw new Error('Existing skill overlap requires explicitly selected matching metadata');
    const episodes=group.episode_ids.map(id=>report.episodes?.find(e=>e.id===id));if(episodes.some(e=>!e))throw new Error('Unknown workflow episode');
    if(episodes.some(e=>['analyzer','control'].includes(e!.request_kind??'unknown'))){notes.push('Workflow '+group.id+': identifiable analyzer/control activity excluded.');continue;}
    const sids=[...new Set(episodes.map(e=>e!.session_id))];if(sids.length<2)throw new Error('Workflow recurrence requires multiple selected sessions');
    const evidence=new Set(episodes.flatMap(e=>e!.evidence_ids));if(group.evidence_ids.some(id=>!evidence.has(id))||episodes.some(e=>!e!.request_evidence_id||!group.evidence_ids.includes(e!.request_evidence_id)))throw new Error('Workflow must cite every request and selected contextual evidence');
    // A reviewer may explicitly find similarly worded requests non-equivalent.
    if(group.equivalent===false){notes.push('Workflow '+group.id+': non-equivalent conditions/outputs; no candidate.');continue;}
    const superseded=new Set(feedback?.entries.flatMap(e=>e.supersedes?[e.supersedes]:[])??[]);
    const useful=feedback?.entries.some(entry=>!superseded.has(entry.id)&&entry.review.evidence_sufficient===true&&entry.review.correct===true&&(entry.review.usefulness??0)>=4&&entry.attempt.state==='attempted'&&entry.follow_up?.basis==='observed_test'&&entry.follow_up.outcome==='improved'&&entry.follow_up.correctness==='preserved'&&entry.episode_ids.some(id=>group.episode_ids.includes(id)));
    const verified=episodes.every(e=>e!.outcome.state==='verified'&&e!.outcome.basis==='reviewer_assessment'&&e!.outcome.evidence_ids.every(id=>group.evidence_ids.includes(id)));
    const actionable=group.equivalent===true&&verified&&useful;
    const key=fingerprint([group.id,group.episode_ids,group.evidence_ids]).slice(0,20),fid='finding:workflow:'+key,rid='recommendation:workflow:'+key;
    const uncertainty=group.uncertainty+(actionable?' Benefit remains a hypothesis outside the selected trials.':' Deferred: equivalent conditions, reviewed verified outcomes or relevant observed usefulness remain insufficient.');
    findings.push({id:fid,category:'repeatable_tasks',rule_id:'contextual_reusable_workflow',title:group.title,severity:'low',claim_type:'inferred',confidence:actionable?'medium':'low',session_ids:sids,evidence_ids:group.evidence_ids,observation:`Selected episode comparison: conditions ${group.conditions}; decisions ${group.decisions}; outputs ${group.outputs}.`,interpretation:`Proposed ${group.kind}; applicability: ${group.applicability}. ${uncertainty}`,recommendation_ids:actionable?[rid]:[]});
    if(actionable)recommendations.push({id:rid,title:group.title,action:`${group.existing_skill_id?'Extend explicitly selected skill '+group.existing_skill_id:'Create a '+group.kind} for ${group.trigger}. Applicability: ${group.applicability}. Preserve ${group.decisions} and ${group.outputs}. Verification: ${group.acceptance_tests.join('; ')}. ${uncertainty}`,kind:group.kind,priority:'low',finding_ids:[fid],overlap_group:'workflow:'+key});
    if(group.kind==='skill')skill_candidates.push({id:'candidate:workflow:'+key,title:group.title,trigger:group.trigger,session_ids:sids,evidence_ids:group.evidence_ids,recommendation:actionable?group.existing_skill_id?'extend':'create':'defer',rationale:`${group.conditions}; ${group.decisions}; ${group.outputs}. ${uncertainty}`,acceptance_tests:group.acceptance_tests});
  }
  const result=mergeInterpretation(report,{findings,recommendations,skill_candidates});result.analysis_usage.notes.push(...notes,'Contextual workflow grouping supplied by the calling reviewer; equivalence is inferred, not measured.');return result;
}
