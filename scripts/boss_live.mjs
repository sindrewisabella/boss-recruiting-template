#!/usr/bin/env node
// Attach-only preflight and bounded preview. This module has no message sender.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const normalized=s=>String(s||'').replace(/\s+/g,' ').trim();
const fail=message=>{throw new Error(message)};
export function assertJob(binding, current) {
  if(!binding?.jobId || !binding?.label) fail('岗位配置缺少真实 ID 或完整标签');
  if(current.jobId!==binding.jobId || normalized(current.label)!==normalized(binding.label)) fail('岗位 ID／标签不符，停止');
}
export function cardFacts(card, observedAt) {
  const facts={};
  const fact=(value,evidence)=>({value,evidence,source:'BOSS 推荐卡片（候选人自述，未经项目核验）',observedAt});
  const degree=card.base.match(/(?:^|\s)(博士|硕士|本科|大专|高中|中专)(?:\s|$)/)?.[1];
  if(degree) facts.education= fact(degree,card.base);
  // Card shows total work years, not relevant development years: retain that distinction.
  const years=card.base.match(/(?:^|\s)(\d+(?:\.\d+)?)年(?:\s|$)/)?.[1];
  if(years) facts.totalWorkYears= fact(Number(years),card.base);
  if(card.professionalText) facts.visibleProfessionalText=fact(card.professionalText,card.professionalText);
  return facts;
}
function options(argv) {
  const command=argv.shift();
  if(!['doctor','jobs','preview','switch-trial'].includes(command)) fail('命令：doctor / jobs / preview / switch-trial');
  const opts={command};
  while(argv.length){const key=argv.shift();if(!['--runtime','--profile','--limit','--out'].includes(key)||!argv.length)fail('未知或缺值参数');opts[key.slice(2)]=argv.shift();}
  if(!opts.runtime)fail('必须指定 --runtime');
  opts.limit=Number(opts.limit||10);
  if(!Number.isInteger(opts.limit)||opts.limit<1||opts.limit>25)fail('只读样本上限为 1—25');
  if(['preview','switch-trial'].includes(command)&&!opts.profile)fail('必须指定 --profile');
  return opts;
}
async function main() {
  const opts=options(process.argv.slice(2));
  const runtime=JSON.parse(fs.readFileSync(opts.runtime,'utf8'));
  if(!Number.isInteger(runtime.port)||runtime.port<1||runtime.port>65535)fail('调试端口无效');
  if(!runtime.dependencyPackage || !runtime.stateDirectory)fail('缺少 dependencyPackage / stateDirectory');
  const state=path.resolve(runtime.stateDirectory);
  fs.mkdirSync(state,{recursive:true,mode:0o700});
  if(fs.existsSync(path.join(state,'halt.json')))fail('上次已持久停止；先检查 halt.json 与平台状态，不自动恢复');
  const lock=path.join(state,'preview-session.lock');
  if(runtime.legacyLock && fs.existsSync(runtime.legacyLock))fail('旧运行器正在占用会话；停止，不删除它的锁');
  try{fs.mkdirSync(lock,{mode:0o700});}catch{fail('另一个框架进程已占用会话；先核对进程，不自动删锁');}
  fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),{mode:0o600});
  const result={ok:false,runId:crypto.randomUUID(),adapterHash:crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),command:opts.command,startedAt:new Date().toISOString(),mode:'live_no_send',messageClicks:0,observedGreetingRequests:0,scanLimit:opts.limit,checks:{},steps:[]};
  let browser, page, stopped='';
  const check=()=>{if(runtime.legacyLock&&fs.existsSync(runtime.legacyLock))fail('旧运行器取得会话锁，停止');if(stopped)fail(stopped)};
  try{
    const require=createRequire(path.resolve(runtime.dependencyPackage));
    const puppeteer=require('puppeteer-core');
    browser=await puppeteer.connect({browserURL:`http://127.0.0.1:${runtime.port}`,protocolTimeout:15000});
    const pages=(await browser.pages()).filter(p=>{try{const u=new URL(p.url());return u.origin==='https://www.zhipin.com'&&u.pathname==='/web/chat/recommend'}catch{return false}});
    if(pages.length!==1)fail(`需要唯一一个 BOSS 招聘端「推荐牛人」标签页；找到 ${pages.length} 个`);
    page=pages[0];
    page.on('request',r=>{try{const u=new URL(r.url());if(u.hostname==='www.zhipin.com'&&u.pathname==='/wapi/zpjob/chat/start'){result.observedGreetingRequests++;stopped='会话出现打招呼请求；停止只读试验，核对其他操作者';}}catch{}});
    page.on('response',r=>{try{if(new URL(r.url()).hostname.endsWith('zhipin.com')&&[403,429].includes(r.status()))stopped=`平台返回 ${r.status()}，停止`;}catch{}});
    async function frame(){
      check();
      const actor=normalized(await page.$eval('.link-usecenter',e=>e.textContent));
      if(runtime.expectedAccountLabel&&actor!==normalized(runtime.expectedAccountLabel))fail('招聘账号标签变化，停止');
      const frames=page.frames().filter(f=>{try{const u=new URL(f.url());return u.origin==='https://www.zhipin.com'&&u.pathname==='/web/frame/recommend/'}catch{return false}});
      if(frames.length!==1)fail('推荐列表框架未就绪／登录失效，停止');
      const f=frames[0];
      const risk=await f.evaluate(()=>/操作频繁|访问异常|账号异常|安全验证|请完成验证|滑动验证/.test(document.body?.innerText||''));
      if(risk)fail('页面出现验证或风险提示，停止');
      return f;
    }
    async function current(){const f=await frame();return await f.evaluate(()=>({jobId:new URL(location.href).searchParams.get('jobid'),label:document.querySelector('.job-selecter-wrap .ui-dropmenu-label')?.textContent?.replace(/\s+/g,' ').trim()}));}
    async function jobs(){const f=await frame();return f.evaluate(()=>Array.from(document.querySelectorAll('.job-selecter-options .job-list .job-item')).map(e=>({jobId:e.getAttribute('value'),label:(e.querySelector('.label')?.textContent||'').replace(/\s+/g,' ').trim()})));}
    const original=await current();
    if(!original.jobId||!original.label)fail('缺少当前岗位身份');
    const shell=await page.evaluate(()=>({visible:document.visibilityState==='visible',hrMenu:!!document.querySelector('.menu-list'),risk:/操作频繁|访问异常|账号异常|安全验证|请完成验证|滑动验证/.test(document.body?.innerText||'')}));
    if(!shell.hrMenu||shell.risk)fail('招聘端菜单未加载或存在风险提示');
    result.checks={attached:true,hrRecommendLoaded:true,riskPromptObserved:false,visible:shell.visible,currentJob:original,accountLabel:normalized(await page.$eval('.link-usecenter',e=>e.textContent)),accountIdentityVerified:!!runtime.expectedAccountLabel,greetingVerified:false};
    result.availableJobs=await jobs();
    async function select(binding){
      const before=await current();
      if(before.jobId===binding.jobId){assertJob(binding,before);return;}
      let f=await frame();
      const list=await jobs();
      if(list.filter(j=>j.jobId===binding.jobId&&normalized(j.label)===normalized(binding.label)).length!==1)fail('岗位列表中无唯一 ID＋标签匹配');
      const previousFirst=await f.evaluate(()=>document.querySelector('.candidate-card-wrap [data-geekid]')?.getAttribute('data-geekid'));
      await f.click('.job-selecter-wrap .ui-dropmenu-label');
      await f.waitForFunction(()=>{const e=document.querySelector('.job-selecter-options');return !!e&&!!e.getBoundingClientRect().height&&getComputedStyle(e).visibility!=='hidden'}, {timeout:5000});
      check();
      // Click only a known job-list row, never a candidate or greeting button.
      const handles=await f.$$('.job-selecter-options .job-list .job-item');
      let matching=[];
      for(const h of handles){const j=await h.evaluate(e=>({jobId:e.getAttribute('value'),label:(e.querySelector('.label')?.textContent||'').replace(/\s+/g,' ').trim()}));if(j.jobId===binding.jobId&&normalized(j.label)===normalized(binding.label))matching.push(h);}
      if(matching.length!==1)fail('岗位列表在点击前发生变化');
      await matching[0].click();
      const deadline=Date.now()+8000;
      while(Date.now()<deadline){check();const now=await current();if(now.jobId===binding.jobId){assertJob(binding,now);const nextFrame=await frame();const first=await nextFrame.evaluate(()=>document.querySelector('.candidate-card-wrap [data-geekid]')?.getAttribute('data-geekid'));if(first&&first!==previousFirst){result.steps.push({action:'select_job',jobId:now.jobId,readBack:true,candidateListReloaded:true});return;}}await new Promise(r=>setTimeout(r,200));}
      fail('岗位选择后回读未匹配，停止；不再次点击');
    }
    if(['preview','switch-trial'].includes(opts.command)){
      const validator=spawnSync(runtime.pythonExecutable||'python3',[path.join(path.dirname(fileURLToPath(import.meta.url)),'boss_template.py'),'validate','--profile',opts.profile],{encoding:'utf8',timeout:10000});
      if(validator.status!==0)fail(`岗位配置校验失败：${validator.stderr||validator.error?.message||'未知错误'}`);
      result.ruleHash=JSON.parse(validator.stdout).ruleHash;
      result.matcherHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'boss_template.py'))).digest('hex');
      let profile=JSON.parse(fs.readFileSync(opts.profile,'utf8'));
      if(profile.screeningProfile){if(path.basename(profile.screeningProfile)!==profile.screeningProfile)fail('画像引用必须是同目录文件');const base=JSON.parse(fs.readFileSync(path.join(path.dirname(opts.profile),profile.screeningProfile),'utf8'));profile={...base,jobBindings:profile.jobBindings};}
      if(profile.schemaVersion!==1||!Array.isArray(profile.jobBindings)||profile.jobBindings.length!==1)fail('试验配置必须绑定一个真实岗位');
      const binding=profile.jobBindings[0];
      await select(binding);
      assertJob(binding,await current());
      const f=await frame();
      // Read current rendered cards only; no paging, scrolling, resume opening or private API replay.
      const raw=await f.evaluate(limit=>Array.from(document.querySelectorAll('.candidate-card-wrap:not(.anonymous-geek-guide-card)')).slice(0,limit).map(c=>({candidateId:c.querySelector('[data-geekid]')?.getAttribute('data-geekid'),base:c.querySelector('.base-info')?.textContent?.replace(/\s+/g,' ').trim()||'',professionalText:[c.querySelector('.geek-desc .content')?.textContent,c.querySelector('.work-exps')?.textContent,c.querySelector('.tags-wrap')?.textContent].filter(Boolean).join('\n').trim()})),opts.limit);
      if(!raw.length)fail('当前页没有可读取的人选卡片');
      if(raw.some(c=>!c.candidateId)||new Set(raw.map(c=>c.candidateId)).size!==raw.length)fail('候选人 ID 缺失或重复，不用姓名替代');
      result.profileId=profile.profileId;
      result.profileRevision=profile.revision;
      result.targetJob=await current();
      result.candidates=raw.map(c=>({candidateKey:crypto.createHash('sha256').update(c.candidateId).digest('hex'),facts:cardFacts(c,result.startedAt)}));
      result.sampleCount=raw.length;
      const matcher=spawnSync(runtime.pythonExecutable||'python3',[path.join(path.dirname(fileURLToPath(import.meta.url)),'boss_template.py'),'evaluate','--profile',opts.profile,'--candidates','-'],{input:JSON.stringify(result.candidates),encoding:'utf8',timeout:10000});
      if(matcher.status!==0)fail(`匹配失败：${matcher.stderr||matcher.error?.message||'未知错误'}`);
      result.matchPlan=JSON.parse(matcher.stdout);
      if(result.matchPlan.ruleHash!==result.ruleHash)fail('运行期间画像规则变化，停止');
      check();
      if(opts.command==='switch-trial')await select(original);
      result.finalJob=await current();
    }
    check();result.ok=true;
  }catch(error){result.stopReason=error.message;process.exitCode=2;if(/平台返回|风险提示|验证|会话出现打招呼请求|账号标签变化/.test(error.message))fs.writeFileSync(path.join(state,'halt.json'),JSON.stringify({runId:result.runId,reason:error.message,at:new Date().toISOString()}),{mode:0o600});}
  finally{
    if(browser)browser.disconnect();
    result.finishedAt=new Date().toISOString();
    try{if(opts.out){const out=path.resolve(opts.out);fs.mkdirSync(path.dirname(out),{recursive:true,mode:0o700});fs.writeFileSync(out,JSON.stringify(result,null,2),{mode:0o600});}}finally{fs.rmSync(lock,{recursive:true});}
  }
  const {candidates,...summary}=result;
  console.log(JSON.stringify(summary,null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(JSON.stringify({ok:false,stopReason:e.message}));process.exitCode=2;});
