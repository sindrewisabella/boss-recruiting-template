import fs from 'node:fs';
import path from 'node:path';
import {hash,matchesResumeScope,appendEvent,writeJson} from './boss_config.mjs';
import {createChatAdapter} from './boss_chat.mjs';
import {wait,withSession} from './boss_platform.mjs';

export function resumeDecision(state,phase,history={}){
 if(phase==='accept')return {kind:'attachments',messageIds:state.pending};
 if(state.doNotContact)return {kind:'opt_out_review'};
 if(state.pending.length)return {kind:'pending_attachment'};
 if(state.attachments.length||state.onlineResume)return {kind:'already_has_resume'};
 if(state.requested||history.requested)return {kind:'already_requested'};
 if(history.unknown)return {kind:'unresolved_history'};
 if(state.buttonExists===false||state.unrecognizedResumeCards?.length)return {kind:'needs_review'};
 if(!state.available)return {kind:'unavailable'};
 return {kind:'request'};
}
export function readResumeHistory(files){
 const requested=new Set(),accepted=new Set(),intents=new Set(),resolved=new Set();
 for(const file of files){
  if(!fs.existsSync(file))continue;
  for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){
   const r=JSON.parse(line),type=r.stage||r.type,c=r.conversationFingerprint||r.fingerprint;
   if(!c)continue;
   const m=r.messageFingerprint,key=(type?.startsWith('accept')?'accept:':'request:')+c+(m?':'+m:'');
   if(type==='requested'){requested.add(c);resolved.add(key);}
   if(type==='accepted'){accepted.add(c+':'+m);resolved.add(key);}
   if(type==='request_intent'||type==='accept_intent'||type==='request_unresolved'||type==='accept_unresolved')intents.add(key);
  }
 }
 return {requested,accepted,unknown:new Set([...intents].filter(k=>!resolved.has(k)))};
}
export async function runResumePhase(cfg,phase,{session,adapter,pace=wait}={}){
 if(!['request','accept'].includes(phase))throw Error('简历阶段不支持此动作');
 if(cfg.execute&&(!cfg.auth.actions.includes(phase)||!cfg.auth.approval.actions.includes(phase)))throw Error('本轮未授权该简历阶段');
 const file=path.join(cfg.runDir,`${phase}-progress.json`),journal=path.join(cfg.runtime.stateDirectory,'resume-events.ndjson');
 const result=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{runId:cfg.auth.runId,phase,requested:0,accepted:0,unknown:0,inspected:0,inspectedFingerprints:[],skipped:{},startedAt:new Date().toISOString()};
 if(result.runId!==cfg.auth.runId)throw Error('简历进度不属于本轮');
 const historyFiles=[journal];
 for(const dir of cfg.auth.legacyResumeDirectories||[])if(fs.existsSync(dir))historyFiles.push(...fs.readdirSync(dir).filter(f=>f.endsWith('.ndjson')).map(f=>path.join(dir,f)));
 const history=readResumeHistory(historyFiles),inspected=new Set(result.inspectedFingerprints);
 const emit=(stage,row,mid,extra={})=>appendEvent(journal,{runId:cfg.auth.runId,stage,jobId:row.jobId,conversationFingerprint:hash(row.id),...(mid?{messageFingerprint:hash(mid)}:{}),...extra});
 const save=()=>{result.inspectedFingerprints=[...inspected];result.distinctInspected=inspected.size;result.updatedAt=new Date().toISOString();writeJson(file,result);};
 let batchWrites=0;
 const checkpoint=async a=>{save();if(++batchWrites>=cfg.controls.batchSize){batchWrites=0;const end=Date.now()+cfg.controls.batchPauseMs;do{await a.guard();const remaining=end-Date.now();if(remaining<=0)break;await pace(Math.min(1000,remaining));}while(true);}else if(cfg.controls.betweenActionsMs)await pace(cfg.controls.betweenActionsMs);};
 const perform=async s=>{
  const a=adapter||createChatAdapter(s,cfg);
  await a.prepare();result.status='running';result.passes=0;save();
  const maxPasses=phase==='accept'&&cfg.execute?cfg.controls.maxAcceptPasses:1;
  for(let pass=0;pass<maxPasses;pass++){
   await a.guard();const inventory=await a.inventory();
   result.fullListReached=inventory.reachedEnd;result.listCount=inventory.rows.length;
   if(!inventory.reachedEnd)throw Error('沟通列表未确认到底，不能宣称全范围完成');
   for(const row of inventory.rows){
    const b=cfg.bindings.find(b=>b.jobId===row.jobId);
    if(b&&String(row.job).replace(/\s+/g,' ').trim()!==b.conversationTitle)throw Error('岗位 ID 对应的会话标题变化，先核对配置');
    if(!row.jobId&&cfg.bindings.some(b=>b.conversationTitle===String(row.job).replace(/\s+/g,' ').trim()))throw Error('目标岗位会话缺少稳定岗位 ID');
   }
   const rows=inventory.rows.filter(r=>matchesResumeScope(r,cfg));
   result.scopeCount=rows.length;result.passes++;result.deferredByBudget=0;result.unresolvedHistory=0;result.needsReview=0;let found=0;const unresolvedKeys=new Set();
   if(rows.length>cfg.controls.maxConversations){result.status='scope_over_budget';save();return;}
   for(const row of rows){
    await a.guard();await a.open(row);const before=await a.state(row),c=hash(row.id);
    if(new Set(before.pending).size!==before.pending.length)throw Error('待同意消息编号重复');
    inspected.add(c);result.inspected++;
    const decision=resumeDecision(before,phase,{requested:history.requested.has(c),unknown:history.unknown.has('request:'+c)});
    if(phase==='request'){
     if(decision.kind!=='request'){
      result.skipped[decision.kind]=(result.skipped[decision.kind]||0)+1;
      if(decision.kind==='unresolved_history')unresolvedKeys.add('request:'+c);
      if(decision.kind==='needs_review')result.needsReview++;
     }else if(!cfg.execute){result.eligible=(result.eligible||0)+1;}
     else if(result.requested>=cfg.budgets.request){result.deferredByBudget++;}
     else{
      emit('request_intent',row);save();
      try{
       await a.request(row,before);const after=await a.state(row);
       if(!after.requested||after.confirmOpen)throw Error('没有明确的已请求标记，不把按钮变灰当成功');
       result.requested++;history.requested.add(c);emit('requested',row,null,{verifiedBy:'ui_request_marker'});
      }catch(error){result.unknown++;emit('request_unresolved',row,null,{reason:error.message});writeJson(path.join(cfg.runtime.stateDirectory,'halt.json'),{runId:cfg.auth.runId,phase,reason:error.message,conversationFingerprint:c});save();throw error;}
      await checkpoint(a);
     }
    }else{
     result.needsReview+=(before.unrecognizedResumeCards||[]).length;
     for(const k of history.unknown)if(k.startsWith('accept:'+c+':'))unresolvedKeys.add(k);
     found+=before.pending.length;
     for(const mid of before.pending){
      const key=c+':'+hash(mid);
      if(history.accepted.has(key)||history.unknown.has('accept:'+key)){unresolvedKeys.add('accept:'+key);continue;}
      if(!cfg.execute)continue;
      if(result.accepted>=cfg.budgets.accept){result.deferredByBudget++;continue;}
      emit('accept_intent',row,mid);save();
      try{
       const current=await a.state(row);
       if(!current.pending.includes(mid))throw Error('附件卡片已变化；不换成其他卡片继续点击');
       await a.accept(row,mid,current);const after=await a.state(row);
       if(after.pending.includes(mid)||!after.attachments.some(id=>id===mid||!current.attachments.includes(id)))throw Error('同意后缺少新增附件证据');
       result.accepted++;history.accepted.add(key);emit('accepted',row,mid,{verifiedBy:'ui_attachment_after_consent'});
      }catch(error){result.unknown++;emit('accept_unresolved',row,mid,{reason:error.message});writeJson(path.join(cfg.runtime.stateDirectory,'halt.json'),{runId:cfg.auth.runId,phase,reason:error.message,conversationFingerprint:c,messageFingerprint:hash(mid)});save();throw error;}
      await checkpoint(a);
     }
    }
    result.unresolvedHistory=unresolvedKeys.size;if(result.inspected%25===0)save();
   }
   if(await a.confirmationOpen())throw Error('仍有简历请求确认框');
   result.lastPassPendingObserved=found;result.reviewCutoff=new Date().toISOString();save();
   if(!cfg.execute){result.status='inspected';result.remainingPending=phase==='accept'?found:null;return;}
   if(phase==='request'){result.status=result.deferredByBudget||result.unresolvedHistory||result.needsReview?'partial':'complete';return;}
   if(found===0){result.remainingPending=result.unresolvedHistory||result.needsReview?null:0;result.status=result.unresolvedHistory||result.needsReview?'partial':'complete';return;}
   if(result.deferredByBudget||result.unresolvedHistory||result.needsReview){result.status='partial';result.remainingPending=null;return;}
  }
  result.status='partial';result.remainingPending=null;result.stopReason='复查轮数用尽，未完成完整零待处理复查';
 };
 try{if(adapter)await perform();else if(session)await perform(session);else await withSession(cfg.runtime,perform);}
 catch(error){result.status='stopped';result.stopReason=error.message;}
 finally{save();}
 return result;
}
