import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadConfig,matchesResumeScope,businessDate,hash} from './boss_config.mjs';
import {reconcileGreetings,workflowStatus} from './boss_result.mjs';
import {runResumePhase} from './boss_resumes.mjs';
import {runWorkflow} from './boss_workflow.mjs';
import {runGreetings} from './boss_send.mjs';

const temp=[];process.on('exit',()=>temp.forEach(d=>fs.rmSync(d,{recursive:true,force:true})));
function configuration({actions=['request'],budget=20,scope={mode:'all_history'}}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boss-framework-test-'));temp.push(dir);
 const runtime={stateDirectory:path.join(dir,'state')};fs.writeFileSync(path.join(dir,'runtime.json'),JSON.stringify(runtime));
 const ops={schemaVersion:1,profileId:'synthetic-ops',revision:'1',missingEvidence:'needs_review',must:[{field:'firstDegree',operator:'equals',value:'本科'}],reject:[],jobBindings:[{jobId:'ops-a',label:'运维工程师 _ 深圳 13-26K'},{jobId:'ops-b',label:'运维工程师 _ 深圳 13-26K'}]};
 const growth={...ops,profileId:'synthetic-growth',must:[{field:'visibleProfessionalText',operator:'contains_any',value:['SEO']}],jobBindings:[{jobId:'growth-a',label:'增长工程师 _ 厦门 20-30K'},{jobId:'other-a',label:'新岗位 _ 深圳 10-20K'}]};
 fs.writeFileSync(path.join(dir,'ops.json'),JSON.stringify(ops));fs.writeFileSync(path.join(dir,'growth.json'),JSON.stringify(growth));
 const auth={schemaVersion:2,runId:'synthetic-run',runDirectory:'run',runtimeFile:'runtime.json',businessDate:businessDate(new Date()),profiles:['ops.json','growth.json'],jobIds:['ops-a','growth-a'],actions,budgets:{request:budget,accept:budget,greet:1},resumeScope:scope,approval:{source:'offline fixture only',actions,allHistory:true},greeting:'合成试验话术',controls:{batchPauseMs:0,betweenActionsMs:0,maxConversations:100}};
 const file=path.join(dir,'auth.json');fs.writeFileSync(file,JSON.stringify(auth));
 return {cfg:loadConfig(file,{execute:true}),file,dir,auth};
}
const row=(id,jobId='ops-a',job='运维工程师',time=Date.now())=>({id,jobId,job,time});
const empty=()=>({pending:[],attachments:[],onlineResume:false,requested:false,available:true,confirmOpen:false});
function fakeAdapter(rows,states={},options={}){
 const calls={request:[],accept:[],open:[],inventory:0};
 const get=r=>states[r.id]||(states[r.id]=empty());
 return {calls,states,async prepare(){},async guard(){},async inventory(){calls.inventory++;options.onInventory?.(calls.inventory,states);return {rows:calls.inventory%2?rows:[...rows].reverse(),reachedEnd:options.reachedEnd!==false};},
  async open(r){calls.open.push(r.id);if(options.wrongIdentity===r.id)throw Error('identity mismatch');},
  async state(r){return structuredClone(get(r));},
  async request(r){calls.request.push(r.id);if(!options.noRequestMarker)get(r).requested=true;get(r).available=false;if(options.requestThrows)throw Error('receipt timeout');},
  async accept(r,mid){calls.accept.push([r.id,mid]);get(r).pending=get(r).pending.filter(x=>x!==mid);if(!options.noAttachment)get(r).attachments.push(mid);},
  async confirmationOpen(){return false;}
 };
}
test('arbitrary profile/job count; same title does not authorize another job ID',()=>{
 const {cfg,file,auth}=configuration();
 assert.equal(cfg.bindings.length,2);assert.equal(matchesResumeScope(row('one'),cfg),true);
 assert.equal(matchesResumeScope(row('two','ops-b'),cfg),false);
 assert.equal(matchesResumeScope(row('three','growth-a','增长工程师'),cfg),true);
 delete auth.jobIds;fs.writeFileSync(file,JSON.stringify(auth));assert.equal(loadConfig(file,{execute:true}).bindings.length,4);
 auth.jobIds=['other-a'];fs.writeFileSync(file,JSON.stringify(auth));assert.equal(loadConfig(file,{execute:true}).bindings.length,1);
});
test('old authorization/date cannot execute; default plan has no approval requirement',()=>{
 const {file,auth}=configuration();auth.businessDate='2020-01-01';fs.writeFileSync(file,JSON.stringify(auth));
 assert.throws(()=>loadConfig(file,{execute:true}),/日期/);assert.equal(loadConfig(file).execute,false);
 auth.schemaVersion=1;fs.writeFileSync(file,JSON.stringify(auth));assert.throws(()=>loadConfig(file),/schemaVersion/);
});
test('configuration mutation is detected before action',()=>{
 const {cfg,file,auth}=configuration();auth.runId='changed';fs.writeFileSync(file,JSON.stringify(auth));assert.throws(()=>cfg.assertFrozen(),/发生变化/);
});
test('another stage configuration cannot be used to send greetings or accept resumes',async()=>{
 const {cfg}=configuration({actions:['request']});
 await assert.rejects(()=>runGreetings(cfg),/未授权打招呼/);
 await assert.rejects(()=>runResumePhase(cfg,'accept',{adapter:fakeAdapter([])}),/未授权/);
});
test('full request scope uses one controller for ops and growth, excludes unauthorized duplicates',async()=>{
 const {cfg}=configuration();const rows=[row('ops'),row('growth','growth-a','增长工程师'),row('same-title-other-id','ops-b'),row('already'),row('resume'),row('disabled')];
 const a=fakeAdapter(rows,{already:{...empty(),requested:true},resume:{...empty(),attachments:['existing']},disabled:{...empty(),available:false}});
 const r=await runResumePhase(cfg,'request',{adapter:a});
 assert.equal(r.status,'complete');assert.deepEqual(a.calls.request,['ops','growth']);assert.equal(r.requested,2);assert.equal(r.scopeCount,5);
 const second=await runResumePhase(cfg,'request',{adapter:a});assert.equal(second.requested,2);assert.equal(a.calls.request.length,2);
});
test('same generic accept controller handles multiple roles/cards and fully rescans reordered list',async()=>{
 const {cfg}=configuration({actions:['accept']});const a=fakeAdapter([row('ops'),row('growth','growth-a','增长工程师'),row('phone')],{ops:{...empty(),pending:['o1']},growth:{...empty(),pending:['g1','g2']},phone:{...empty(),phoneRequest:true}});
 const r=await runResumePhase(cfg,'accept',{adapter:a});assert.equal(r.status,'complete');assert.equal(r.accepted,3);assert.equal(r.passes,2);assert.equal(r.remainingPending,0);assert.equal(a.calls.accept.some(([id])=>id==='phone'),false);
});
test('late attachment requires another full pass; no early zero claim',async()=>{
 const {cfg}=configuration({actions:['accept']});const a=fakeAdapter([row('ops')],{ops:{...empty(),pending:['first']}},{onInventory:(n,s)=>{if(n===2)s.ops.pending.push('late');}});
 const r=await runResumePhase(cfg,'accept',{adapter:a});assert.equal(r.status,'complete');assert.equal(r.accepted,2);assert.equal(r.passes,3);
});
test('budget stops writes and reports partial rather than treating batch as all done',async()=>{
 const {cfg}=configuration({actions:['accept'],budget:1});const a=fakeAdapter([row('ops')],{ops:{...empty(),pending:['one','two']}});
 const r=await runResumePhase(cfg,'accept',{adapter:a});assert.equal(r.status,'partial');assert.equal(r.accepted,1);assert.equal(r.remainingPending,null);assert.equal(a.calls.accept.length,1);
});
test('list not reached end means no resume write and no complete result',async()=>{
 const {cfg}=configuration();const a=fakeAdapter([row('ops')],{},{reachedEnd:false});const r=await runResumePhase(cfg,'request',{adapter:a});assert.equal(r.status,'stopped');assert.equal(a.calls.request.length,0);
});
test('explicit do-not-contact state never triggers an outbound resume request',async()=>{
 const {cfg}=configuration();const a=fakeAdapter([row('ops')],{ops:{...empty(),doNotContact:true}});
 const r=await runResumePhase(cfg,'request',{adapter:a});assert.equal(r.requested,0);assert.equal(r.skipped.opt_out_review,1);assert.equal(a.calls.request.length,0);
});
test('unknown resume-card layout cannot be treated as a zero-pending complete scan',async()=>{
 const {cfg}=configuration({actions:['accept']});const a=fakeAdapter([row('ops')],{ops:{...empty(),unrecognizedResumeCards:['changed-card']}});
 const r=await runResumePhase(cfg,'accept',{adapter:a});assert.equal(r.status,'partial');assert.equal(r.remainingPending,null);assert.equal(a.calls.accept.length,0);
});
test('missing request button is review-needed, distinct from disabled button',async()=>{
 const {cfg}=configuration();const a=fakeAdapter([row('ops')],{ops:{...empty(),buttonExists:false,available:false}});
 const r=await runResumePhase(cfg,'request',{adapter:a});assert.equal(r.status,'partial');assert.equal(r.needsReview,1);assert.equal(a.calls.request.length,0);
});
test('missing job ID or changed job title stops before any request',async()=>{
 for(const bad of [row('missing','','运维工程师'),row('changed','ops-a','另一个标题')]){
  const {cfg}=configuration();const a=fakeAdapter([bad]);const r=await runResumePhase(cfg,'request',{adapter:a});assert.equal(r.status,'stopped');assert.equal(a.calls.request.length,0);
 }
});
test('button disabled without request marker is unknown, isolated and never retried',async()=>{
 const {cfg}=configuration();const a=fakeAdapter([row('ops')],{},{noRequestMarker:true});const r=await runResumePhase(cfg,'request',{adapter:a});assert.equal(r.status,'stopped');assert.equal(r.unknown,1);
 const again=await runResumePhase(cfg,'request',{adapter:a});assert.equal(again.status,'partial');assert.equal(a.calls.request.length,1);assert.equal(again.unresolvedHistory,1);
});
test('card disappearing without attachment evidence is unknown, not collected',async()=>{
 const {cfg}=configuration({actions:['accept']});const a=fakeAdapter([row('ops')],{ops:{...empty(),pending:['one']}},{noAttachment:true});const r=await runResumePhase(cfg,'accept',{adapter:a});assert.equal(r.status,'stopped');assert.equal(r.accepted,0);assert.equal(r.unknown,1);
 const again=await runResumePhase(cfg,'accept',{adapter:a});assert.equal(again.status,'partial');assert.equal(a.calls.accept.length,1);
});
test('conversation allowlist restricts exact identities; since is an activity cutoff',()=>{
 const {cfg}=configuration({scope:{mode:'conversation_allowlist',conversationFingerprints:[hash('wanted')]}});assert.equal(matchesResumeScope(row('wanted'),cfg),true);assert.equal(matchesResumeScope(row('other'),cfg),false);
 cfg.auth.resumeScope={mode:'since',since:'2026-10-09T00:00:00+08:00'};assert.equal(matchesResumeScope(row('early','ops-a','运维工程师',0),cfg),false);
});
test('official reconciliation is part of completion; stale remaining 2 becomes 0',()=>{
 const base={observedAt:'2026-10-09T06:03:48Z',greeted:530,remaining:95,entitlementUsed:505,entitlementLimit:'600'};
 const after={observedAt:'2026-10-09T07:18:34Z',greeted:625,remaining:0,entitlementUsed:400,entitlementLimit:'400'};
 const r=reconcileGreetings({baseline:base,target:95,confirmed:95,unknown:0,status:'running',quotaRemainingFromReceipts:2},after);
 assert.equal(r.status,'complete');assert.equal(r.quotaRemainingFromReceipts,0);assert.equal(r.entitlementDelta,null);
 assert.equal(reconcileGreetings({...r}, {...after,greeted:624}).status,'reconciliation_mismatch');
 assert.throws(()=>reconcileGreetings({...r},{...after,observedAt:'2026-10-10T07:18:34Z'}),/同一香港日期/);
 assert.equal(workflowStatus({greet:r,request:{status:'partial'},accept:{status:'complete'}},['greet','request','accept']),'partial');
});
test('one workflow stops after greeting reconciliation failure before any resume action',async()=>{
 const {cfg}=configuration({actions:['greet','request','accept']});let resumeCalls=0;
 const r=await runWorkflow(cfg,{session:{async guard(){}},stageRunners:{greet:async()=>({status:'reconciliation_mismatch'}),request:async()=>{resumeCalls++;},accept:async()=>{resumeCalls++;}}});
 assert.equal(r.status,'stopped');assert.equal(resumeCalls,0);
});
test('one result merges all three stages; another accept review does not resend greetings/requests',async()=>{
 const {cfg}=configuration({actions:['greet','request','accept']});const calls={greet:0,request:0,accept:0};
 const stages=Object.fromEntries(Object.keys(calls).map(k=>[k,async()=>{calls[k]++;return {status:'complete',confirmed:k==='greet'?1:undefined,requested:k==='request'?2:undefined,accepted:k==='accept'?3:undefined};}]));
 const opt={session:{async guard(){}},stageRunners:stages};
 const r=await runWorkflow(cfg,opt);assert.equal(r.status,'complete');assert.equal(r.stages.request.requested,2);
 await runWorkflow(cfg,opt);assert.deepEqual(calls,{greet:1,request:1,accept:2});
});
