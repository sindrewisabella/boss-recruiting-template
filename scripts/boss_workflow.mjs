#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig,writeJson} from './boss_config.mjs';
import {withSession} from './boss_platform.mjs';
import {runGreetings} from './boss_send.mjs';
import {runResumePhase} from './boss_resumes.mjs';
import {reconcileGreetings,workflowStatus} from './boss_result.mjs';

export function plan(cfg){return {mode:'plan_only',messageClicks:0,runId:cfg.auth.runId,actions:cfg.auth.actions,
 jobs:cfg.bindings.map(b=>({jobId:b.jobId,label:b.label,profileId:b.profileId,ruleHash:b.ruleHash})),
 budgets:cfg.budgets,controls:cfg.controls,resumeScope:cfg.auth.resumeScope||null,
 note:'配置计划不连接浏览器；未验证当前会话、实际按钮或平台许可'};}
export async function runWorkflow(cfg,{session,stageRunners}={}){
 if(!cfg.execute)return plan(cfg);
 const manifestFile=path.join(cfg.runDir,'run-manifest.json');
 const manifest={runId:cfg.auth.runId,businessDate:cfg.auth.businessDate,fileHashes:cfg.fileHashes};
 if(fs.existsSync(manifestFile)&&JSON.stringify(JSON.parse(fs.readFileSync(manifestFile)))!==JSON.stringify(manifest))throw Error('已有运行的代码或配置不同；保留原记录，用新 runId');
 writeJson(manifestFile,manifest);
 const file=path.join(cfg.runDir,'result.json');
 const result=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{runId:cfg.auth.runId,startedAt:new Date().toISOString(),stages:{}};
 const stop=()=>{cfg.cancelled=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
 const save=()=>{result.status=workflowStatus(result.stages,cfg.auth.actions);result.updatedAt=new Date().toISOString();writeJson(file,result);};
 const perform=async s=>{
  for(const stage of cfg.auth.actions){
   cfg.assertFrozen();await s.guard();if(cfg.cancelled)throw Error('用户请求停止');
   if(result.stages[stage]?.status==='complete'&&stage!=='accept')continue;
   result.stages[stage]=stageRunners?.[stage]?await stageRunners[stage](cfg,{session:s}):stage==='greet'?await runGreetings(cfg,{session:s}):await runResumePhase(cfg,stage,{session:s});
   save();
   if(result.stages[stage].status!=='complete')break;
  }
 };
 try{if(session)await perform(session);else await withSession(cfg.runtime,perform);}
 catch(error){result.status='stopped';result.stopReason=error.message;writeJson(file,result);}
 finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);if(!result.stopReason)save();}
 return result;
}
async function main(){
 const args=process.argv.slice(2),command=args.shift(),get=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
 if(command==='reconcile'){
  const file=get('--progress');if(!file)throw Error('reconcile 需要 --progress；仅核对已保存的官方证据');
  const r=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!r.latestOfficial)throw Error('没有已保存的官方结束读回');
  const backup=file+'.before-unified-reconcile.json';if(!fs.existsSync(backup))fs.copyFileSync(file,backup);
  reconcileGreetings(r,r.latestOfficial);writeJson(file,r);console.log(JSON.stringify({mode:'saved_evidence_reconciliation',status:r.status,confirmed:r.confirmed,officialDelta:r.officialDelta,officialRemaining:r.officialRemaining,quotaRemainingFromReceipts:r.quotaRemainingFromReceipts}));return;
 }
 if(!['plan','run'].includes(command))throw Error('命令：plan / run / reconcile');
 const file=get('--authorization');if(!file)throw Error('需要 --authorization 本轮配置');
 const cfg=loadConfig(file,{execute:command==='run'&&args.includes('--execute')});
 const r=command==='plan'?plan(cfg):await runWorkflow(cfg);
 console.log(JSON.stringify(r.stages?{runId:r.runId,status:r.status,stopReason:r.stopReason,stages:Object.fromEntries(Object.entries(r.stages).map(([a,s])=>[a,{status:s.status,confirmed:s.confirmed,requested:s.requested,accepted:s.accepted,unknown:s.unknown,fullListReached:s.fullListReached,remainingPending:s.remainingPending,stopReason:s.stopReason}]))}:r,null,2));
 if(cfg.execute&&r.status!=='complete')process.exitCode=2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(JSON.stringify({error:e.message}));process.exitCode=2;});
