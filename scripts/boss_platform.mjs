import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
export const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
export const wait=ms=>new Promise(r=>setTimeout(r,ms));
export const GREETING='你好，请问最近有考虑新的工作机会么？';
export async function withSession(runtime, callback, {readOnlyAudit=false}={}){
  const locks=[],state=runtime.stateDirectory;
  fs.mkdirSync(state,{recursive:true,mode:0o700});
  if(fs.existsSync(path.join(state,'halt.json'))&&!readOnlyAudit)throw Error('存在未解除的运行停止状态');
  let browser;
  try{
    for(const file of [runtime.legacyLock,path.join(os.homedir(),'.boss-cli/.cache/session.lock'),path.join(state,'preview-session.lock')].filter(Boolean)){
      fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
      const fd=fs.openSync(file,'wx',0o600);locks.push(file);
      try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,createdAt:Date.now(),startedAt:new Date().toISOString(),hostname:os.hostname(),cwd:process.cwd(),command:'boss-framework authorised greeting'}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    }
    const require=createRequire(runtime.dependencyPackage);
    browser=await require('puppeteer-core').connect({browserURL:`http://127.0.0.1:${runtime.port}`,protocolTimeout:20000});
    const pages=(await browser.pages()).filter(p=>{try{return new URL(p.url()).origin==='https://www.zhipin.com'}catch{return false}});
    if(pages.length!==1)throw Error('需要唯一一个 BOSS 网页会话');
    const page=pages[0];let stopped='';
    const halt=reason=>{stopped=reason;fs.writeFileSync(path.join(state,'halt.json'),JSON.stringify({reason,at:new Date().toISOString(),pid:process.pid}),{mode:0o600});};
    const check=()=>{if(stopped)throw Error(stopped);for(const file of locks){if(!fs.existsSync(file)||JSON.parse(fs.readFileSync(file)).pid!==process.pid)throw Error('运行锁丢失或身份变化');}};
    page.on('response',r=>{try{const h=new URL(r.url()).hostname;if((h==='zhipin.com'||h.endsWith('.zhipin.com'))&&[403,429].includes(r.status()))halt(`平台 HTTP ${r.status()}`);}catch{}});
    page.on('framenavigated',f=>{if(/\/passport\/|\/403(?:\.html)?|verify-slider|nonsupport/.test(f.url()))halt('平台风险或验证跳转');});
    async function guard(){check();const u=new URL(page.url());if(u.origin!=='https://www.zhipin.com')throw Error('BOSS 会话离开平台');const actor=norm(await page.$eval('.link-usecenter',e=>e.textContent));if(actor!==norm(runtime.expectedAccountLabel)){halt('账号身份不符');check();}for(const f of page.frames()){if(/\/passport|\/403|\/security|\/verify/.test(f.url())){halt('平台验证或登录限制');check();}const risk=await f.evaluate(()=>{const visible=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';return [...document.querySelectorAll('.geetest_panel,.captcha-container,#captcha')].some(visible)||/操作频繁|访问异常|账号异常|安全验证|请完成验证|滑动验证/.test(document.body?.innerText||'');});if(risk){halt('页面风险提示');check();}}}
    async function frame(prefix){
      const until=Date.now()+20000;
      while(Date.now()<until){check();const f=page.frames().find(f=>f.url().startsWith('https://www.zhipin.com'+prefix));if(f){await f.waitForFunction(()=>document.body&&document.body.innerText.length>0,{timeout:10000});await guard();const risk=await f.evaluate(()=>/操作频繁|访问异常|账号异常|安全验证|请完成验证|滑动验证/.test(document.body?.innerText||''));if(risk)throw Error('框架风险提示');return f;}await wait(200);}
      throw Error('页面框架未就绪，不自动刷新');
    }
    // The account menu loads later than the dashboard body. Keep the exact
    // account check, but allow a bounded wait for its normal rendering.
    async function go(url,prefix){await guard();check();await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});await page.waitForSelector('.link-usecenter',{timeout:30000});return frame(prefix);}
    return await callback({page,frame,go,check,guard,state});
  }finally{if(browser)browser.disconnect();for(const file of locks.reverse()){try{if(JSON.parse(fs.readFileSync(file)).pid===process.pid)fs.unlinkSync(file);}catch{}}}
}
export async function daily(s){
  const f=await s.go('https://www.zhipin.com/web/chat/data-recruit','/web/frame/report/data-center');
  await f.waitForFunction(()=>/我打招呼\s*\d+/.test(document.body?.innerText||''),{timeout:10000});
  // Dashboard numbers animate from small values; never capture the first number.
  await wait(2200);
  let previous='',stable=0;
  const until=Date.now()+8000;
  while(Date.now()<until){const value=await f.evaluate(()=>{const t=document.body.innerText.replace(/\s+/g,' ');return [t.match(/我打招呼\s*(\d+)/)?.[1],t.match(/沟通\s*>?\s*账号权益\s*(\d+)\s*\//)?.[1]].join(':');});if(value===previous)stable++;else stable=0;previous=value;if(stable>=2)break;await wait(500);}
  if(stable<2)throw Error('日报数字未稳定，不记录官方计数');
  const out=await f.evaluate(()=>{const text=document.body.innerText.replace(/\s+/g,' ');const entitlement=text.match(/沟通\s*>?\s*账号权益\s*(\d+)\s*\/\s*(不限|\d+)/);const r=text.match(/当前剩余(\d+)个打招呼权益/);return {source:location.href,observedAt:new Date().toISOString(),greeted:Number(text.match(/我打招呼\s*(\d+)/)?.[1]),entitlementUsed:entitlement?Number(entitlement[1]):null,entitlementLimit:entitlement?entitlement[2]:null,remaining:r?Number(r[1]):null};});
  if(!Number.isFinite(out.greeted)||out.entitlementUsed===null||out.entitlementLimit===null)throw Error('无法读取今日官方计数／权益');
  if(out.remaining===null&&out.entitlementLimit!=='不限')out.remaining=Number(out.entitlementLimit)-out.entitlementUsed;
  return out;
}
export async function greetings(s,bindings){
  const f=await s.go('https://www.zhipin.com/web/chat/set_v2/greeting','/web/frame/info_v2/set/greeting');
  await f.waitForSelector('.tab-item',{timeout:10000});
  const tabs=await f.$$('.tab-item');
  for(const t of tabs)if(norm(await t.evaluate(e=>e.textContent))==='按职位设置招呼语'){await t.click();break;}
  await f.waitForSelector('.greet-job-btn',{timeout:10000});await wait(800);
  const records=[];
  for(const b of bindings){
    if(!b.greetingText)throw Error('配置没有本岗位实际话术');
    const rows=await f.$$('.job-nav>li');let verified=false;
    for(const row of rows){
      if(norm(await row.$eval('.job-name .text-ellipsis',e=>e.textContent))!==norm(b.conversationTitle||b.label.split(' _ ')[0]))continue;
      await s.guard();await row.$eval('.iboss-edit',e=>e.click());
      await f.waitForFunction(()=>document.querySelector('.dialog-body-inner input:checked')&&document.querySelector('.greet-textarea')?.value.length>0,{timeout:10000});
      const saved=await f.evaluate(()=>({ids:[...document.querySelectorAll('.dialog-body-inner input:checked')].map(e=>e.value),text:document.querySelector('.greet-textarea').value}));
      await f.$eval('.gjs-close',e=>e.click());
      await f.waitForFunction(()=>{const e=document.querySelector('.dialog-body-inner .greet-textarea');return !e||!e.getClientRects().length;},{timeout:10000});
      if(saved.ids.length!==1)throw Error('实际话术岗位绑定不唯一');
      if(saved.ids[0]!==b.jobId)continue;
      if(verified)throw Error('同一岗位存在多条话术记录');
      if(saved.text!==b.greetingText)throw Error('实际保存话术与本岗位配置不符');
      verified=true;records.push({jobId:b.jobId,label:b.label,text:saved.text,readBack:true});
    }
    if(!verified)throw Error('缺少目标岗位 ID 对应的已保存话术；不自动修改设置');
  }
  return records;
}
