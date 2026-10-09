#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withSession,daily,greetings,norm,wait} from './boss_platform.mjs';
import {clickWithPlatformReceipt} from './boss_receipt.mjs';
import {ROOT,hash,fingerprint,businessDate,loadConfig} from './boss_config.mjs';
import {reconcileGreetings} from './boss_result.mjs';
import {cardFacts} from './boss_live.mjs';
export async function runGreetings(cfg,{session,maxActions}={}){
if(!cfg.execute)throw Error('此函数为真实发送入口；无 execute 时仅使用计划或只读 preview');
if(!cfg.auth.actions.includes('greet')||!cfg.auth.approval.actions.includes('greet'))throw Error('本轮未授权打招呼，不能从其他阶段配置发送');
const {runtime,bindings}=cfg;
const auth={...cfg.auth,...cfg.controls,target:cfg.budgets.greet,runDirectory:cfg.runDir};
const invocationLimit=maxActions??auth.target;
if(!Number.isInteger(invocationLimit)||invocationLimit<1||invocationLimit>auth.target)throw Error('本次动作上限无效');
const runDir=path.resolve(auth.runDirectory);fs.mkdirSync(runDir,{recursive:true,mode:0o700});
const events=path.join(runtime.stateDirectory,'contact-events.ndjson');
const progressFile=path.join(runDir,'greet-progress.json');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const fingerprint=id=>hash('geek:'+id.trim().toLowerCase());
const profileHash=hash(JSON.stringify(cfg.fileHashes));
const result=fs.existsSync(progressFile)?JSON.parse(fs.readFileSync(progressFile)):{runId:auth.runId,target:auth.target,confirmed:0,clicks:0,unknown:0,startedAt:new Date().toISOString(),byJob:Object.fromEntries(bindings.map(b=>[b.jobId,0])),scanned:0};
if(result.runId!==auth.runId)throw Error('运行 ID 与进度不对应');
if(result.target!==auth.target)throw Error('不能修改已有批次的目标数量');
const save=()=>{result.updatedAt=new Date().toISOString();const tmp=progressFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(result,null,2),{mode:0o600});fs.renameSync(tmp,progressFile);};
function append(event){fs.mkdirSync(path.dirname(events),{recursive:true,mode:0o700});const fd=fs.openSync(events,'a',0o600);try{fs.writeSync(fd,JSON.stringify({at:new Date().toISOString(),runId:auth.runId,...event})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function priorContacts(){const blocked=new Set();for(const file of [events,auth.legacyJournal]){if(!file||!fs.existsSync(file))continue;const byKey=new Map();for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){const row=JSON.parse(line);const key=row.candidateFingerprint;if(!key)continue;if(!byKey.has(key))byKey.set(key,[]);byKey.get(key).push(row.stage);}for(const [key,stages]of byKey){if(stages.includes('acknowledged')||stages.includes('unresolved')||stages.includes('unconfirmed')||(stages.includes('intent')&&!stages.includes('not_clicked')))blocked.add(key);}}return blocked;}
const blocked=priorContacts();
let stopRequested=false;const stop=()=>{stopRequested=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
let invocationConfirmed=0;
try{
const perform=async s=>{
  const guard=async()=>{s.check();await s.guard();if(stopRequested)throw Error('用户或系统请求停止');cfg.assertFrozen();};
  result.adapterHash=hash(fs.readFileSync(fileURLToPath(import.meta.url)));result.profileHash=profileHash;
  if(result.confirmed>0&&!auth.firstGreetingVerified&&invocationLimit>1)throw Error('首条实际话术还未核验，不能扩大批次');
  const greeting=await greetings(s,bindings);fs.writeFileSync(path.join(runDir,'greeting-preflight.json'),JSON.stringify(greeting,null,2));
  const before=await daily(s);
  result.latestOfficial=before;if(!result.baseline)result.baseline=before;
  if(businessDate(new Date(result.baseline.observedAt))!==businessDate(new Date(before.observedAt)))throw Error("不能跨日沿用旧基线");
  if(before.greeted-result.baseline.greeted!==result.confirmed)throw Error("本轮开始对账不符，禁止接续");
  result.invocationInitialRemaining=before.remaining;result.invocationConfirmed=0;
  if(result.confirmed>=auth.target||(before.remaining!==null&&before.remaining<=0)){reconcileGreetings(result,before);save();return;}
  // Expected daily growth exceeding this run's acknowledgements indicates another writer.
  if(before.greeted-result.baseline.greeted>result.confirmed)throw Error('官方新增大于本轮回执，可能有其他写入者，停止');
  result.status='running';save();
  let batchSent=0,scanUnique=new Set(),exhausted=new Set(),jobIndex=0;
  async function current(f){return f.evaluate(()=>({jobId:new URL(location.href).searchParams.get('jobid'),label:document.querySelector('.job-selecter-wrap .ui-dropmenu-label')?.textContent?.replace(/\s+/g,' ').trim()}));}
  async function selected(binding){
    let f=await s.frame('/web/frame/recommend/');const now=await current(f);
    if(now.jobId!==binding.jobId){
      await f.waitForSelector('.job-selecter-wrap .ui-dropmenu-label',{timeout:10000});await f.click('.job-selecter-wrap .ui-dropmenu-label');
      await f.waitForFunction(()=>{const e=document.querySelector('.job-selecter-options');return e&&e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden'},{timeout:5000});
      const rows=await f.$$('.job-selecter-options .job-item');let hit;
      for(const row of rows){const id=await row.evaluate(e=>e.getAttribute('value'));if(id===binding.jobId){if(hit)throw Error('同 ID 岗位重复');const label=norm(await row.$eval('.label',e=>e.textContent));if(label!==norm(binding.label))throw Error('岗位城市或标签变化');hit=row;}}
      if(!hit)throw Error('未找到目标岗位');await hit.click();
      const deadline=Date.now()+15000;
      while(Date.now()<deadline){await guard();f=await s.frame('/web/frame/recommend/');const n=await current(f);if(n.jobId===binding.jobId&&norm(n.label)===norm(binding.label)){await f.waitForSelector('.candidate-card-wrap [data-geekid]',{timeout:10000});await wait(700);return f;}await wait(200);}
      throw Error('换岗后回读失败，不重点击');
    }
    if(norm(now.label)!==norm(binding.label))throw Error('岗位标签变化');return f;
  }
  await s.go('https://www.zhipin.com/web/chat/recommend','/web/frame/recommend/');
  while(result.confirmed<auth.target&&invocationConfirmed<invocationLimit){
    await guard();
    if(before.remaining!==null&&invocationConfirmed>=before.remaining){result.status='quota_boundary';break;}
    const binding=bindings[jobIndex%bindings.length];if(exhausted.has(binding.jobId)){jobIndex++;if(exhausted.size===bindings.length){result.status='no_more_eligible_cards';break;}continue;}
    let f=await selected(binding);
    await f.waitForSelector('.candidate-card-wrap [data-geekid]',{timeout:10000});
    const raw=await f.evaluate(()=>Array.from(document.querySelectorAll('.candidate-card-wrap:not(.anonymous-geek-guide-card)')).map(c=>({id:c.querySelector('[data-geekid]')?.getAttribute('data-geekid'),base:c.querySelector('.base-info')?.textContent?.replace(/\s+/g,' ').trim()||'',text:[c.querySelector('.geek-desc .content')?.textContent,c.querySelector('.work-exps')?.textContent,c.querySelector('.tags-wrap')?.textContent].filter(Boolean).join('\n').trim(),available:(()=>{const b=c.querySelector('.button-chat-wrap .btn.btn-greet');return !!b&&!b.disabled&&!/disabled|forbid|ban/i.test(b.className)&&b.textContent.trim()==='打招呼';})()})));
    if(raw.some(c=>!c.id)||new Set(raw.map(c=>c.id)).size!==raw.length)throw Error('当前卡片身份缺失／重复');
    const fresh=raw.filter(c=>!scanUnique.has(c.id));for(const c of fresh)scanUnique.add(c.id);result.scanned+=fresh.length;
    if(result.scanned>auth.maxScan)throw Error('达到本轮扫描预算');
    const candidates=raw.filter(c=>c.available&&!blocked.has(fingerprint(c.id)));
    const input=candidates.map(c=>({candidateKey:hash(c.id),facts:cardFacts({base:c.base,professionalText:c.text},new Date().toISOString())}));
    const match=spawnSync(runtime.pythonExecutable||'python3',[path.join(ROOT,'scripts/boss_template.py'),'evaluate','--profile',binding.profileFile,'--candidates','-'],{input:JSON.stringify(input),encoding:'utf8',timeout:10000});
    if(match.status!==0)throw Error('匹配器失败：'+match.stderr);
    const evaluation=JSON.parse(match.stdout);result.ruleHashes??={};result.ruleHashes[binding.jobId]=evaluation.ruleHash;
    const good=new Set(evaluation.results.filter(r=>r.decision==='eligible').map(r=>r.candidateKey));
    const candidate=candidates.find(c=>good.has(hash(c.id)));
    if(!candidate){
      // Normal scrolling loads the next recommendation cards, bounded by repeated-ID detection.
      const last=raw[raw.length-1]?.id;
      await f.evaluate(id=>{const e=Array.from(document.querySelectorAll('.candidate-card-wrap')).find(c=>c.querySelector('[data-geekid]')?.getAttribute('data-geekid')===id);e?.scrollIntoView({block:'end'});},last);
      await wait(1800);
      const ids=await f.evaluate(()=>Array.from(document.querySelectorAll('.candidate-card-wrap [data-geekid]')).map(e=>e.getAttribute('data-geekid')));
      if(ids.every(id=>scanUnique.has(id)))exhausted.add(binding.jobId);
      jobIndex++;continue;
    }
    const key=fingerprint(candidate.id);await guard();
    const identity=await current(f);if(identity.jobId!==binding.jobId||norm(identity.label)!==norm(binding.label))throw Error('发送前岗位变化');
    const checks=evaluation.results.find(r=>r.candidateKey===hash(candidate.id)).checks;
    const click=async(frame,target)=>{
      await guard();
      // Resolve identity, facts and button in one DOM operation. Coordinates can
      // move while a recommendation card animates after the preceding greeting.
      const outcome=await frame.evaluate(({id,text,base,jobId})=>{
        if(new URL(location.href).searchParams.get('jobid')!==jobId)return {reason:'job_changed'};
        const rows=Array.from(document.querySelectorAll('.candidate-card-wrap')).filter(c=>c.querySelector('[data-geekid]')?.getAttribute('data-geekid')===id);
        if(rows.length!==1)return {reason:rows.length?'duplicate':'not_found'};
        const c=rows[0],current=[c.querySelector('.geek-desc .content')?.textContent,c.querySelector('.work-exps')?.textContent,c.querySelector('.tags-wrap')?.textContent].filter(Boolean).join('\n').trim();
        if(current!==text||(c.querySelector('.base-info')?.textContent?.replace(/\s+/g,' ').trim()||'')!==base)return {reason:'facts_changed'};
        const button=c.querySelector('.button-chat-wrap .btn.btn-greet');
        if(!button||button.disabled||/disabled|forbid|ban/i.test(button.className)||button.textContent.trim()!=='打招呼')return {reason:'not_found'};
        button.click();return {clicked:true};
      },{id:target.geekId,text:candidate.text,base:candidate.base,jobId:binding.jobId});
      if(!outcome.clicked){const error=Error('发送前检查失败：'+outcome.reason);Object.assign(error,outcome.reason==='not_found'?{code:'BOSS_GREET_PRECLICK_MISSING',preClickKind:'not_found'}:{code:'BOSS_GREET_PRECLICK_ABORT',preClickKind:outcome.reason});throw error;}
    };
    const receipt=await clickWithPlatformReceipt({page:s.page,frame:f,candidate:{geekId:candidate.id},jobId:binding.jobId,click,onClicked:()=>{result.clicks++;save();},writeEvent:(stage,evidence={})=>{append({stage,candidateFingerprint:key,jobId:binding.jobId,matchedKeywords:checks.flatMap(c=>c.matchedKeywords||[]),...evidence});if(stage==='unresolved'){result.unknown++;fs.writeFileSync(path.join(runtime.stateDirectory,'halt.json'),JSON.stringify({runId:auth.runId,candidateFingerprint:key,reason:evidence.reason}),{mode:0o600});save();}}});
    if(!receipt.acknowledged){blocked.add(key);continue;}
    blocked.add(key);result.confirmed++;result.byJob[binding.jobId]++;invocationConfirmed++;result.invocationConfirmed=invocationConfirmed;result.quotaRemainingFromReceipts=before.remaining===null?null:Math.max(0,before.remaining-invocationConfirmed);batchSent++;result.lastCandidateKey=hash(candidate.id);save();
    console.log(JSON.stringify({event:'acknowledged',confirmed:result.confirmed,target:auth.target,jobId:binding.jobId,candidateFingerprint:key}));
    if(invocationConfirmed>=invocationLimit||result.confirmed>=auth.target)break;
    if(batchSent>=auth.batchSize){
      // User requested quota read once before this invocation, then receipt accounting.
      result.quotaRemainingFromReceipts=before.remaining===null?null:before.remaining-invocationConfirmed;save();
      if(result.quotaRemainingFromReceipts!==null&&result.quotaRemainingFromReceipts<=0){result.status='quota_exhausted';break;}
      batchSent=0;jobIndex++;console.log(JSON.stringify({event:'batch_checkpoint',confirmed:result.confirmed,remainingFromReceipts:result.quotaRemainingFromReceipts,pauseSeconds:auth.batchPauseMs/1000}));
      const until=Date.now()+auth.batchPauseMs;while(Date.now()<until){await wait(Math.min(1000,until-Date.now()));await guard();}
    }else await wait(auth.betweenActionsMs);
  }
  const after=await daily(s);reconcileGreetings(result,after);save();
};
if(session)await perform(session);else await withSession(runtime,perform);
}catch(error){result.status='stopped';result.stopReason=error.message;save();console.error(JSON.stringify({event:'stopped',...result}));}
finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
console.log(JSON.stringify({event:'summary',...result}));
return result;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const i=process.argv.indexOf('--authorization');
 if(i<0||!process.argv[i+1])throw Error('必须提供本轮配置 --authorization');
 const cfg=loadConfig(process.argv[i+1],{execute:process.argv.includes('--execute')});
 if(!cfg.execute)throw Error('真实发送需要 --execute；计划使用 boss.command plan');
 const max=process.argv.indexOf('--max-actions');
 runGreetings(cfg,{maxActions:max<0?undefined:Number(process.argv[max+1])}).then(r=>{if(r.status!=='complete')process.exitCode=2;}).catch(e=>{console.error(e.message);process.exitCode=2;});
}
