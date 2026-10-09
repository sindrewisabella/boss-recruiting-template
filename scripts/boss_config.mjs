import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
export const fingerprint=id=>hash('geek:'+String(id).trim().toLowerCase());
export const businessDate=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
export function readProfile(file){
 let p=JSON.parse(fs.readFileSync(file,'utf8')),files=[file];
 if(p.screeningProfile){
  if(path.basename(p.screeningProfile)!==p.screeningProfile)throw Error('画像引用必须在同目录');
  const baseFile=path.join(path.dirname(file),p.screeningProfile),base=JSON.parse(fs.readFileSync(baseFile,'utf8'));
  if(base.screeningProfile)throw Error('不允许多层画像引用');
  p={...base,jobBindings:p.jobBindings};files.push(baseFile);
 }
 return {profile:p,files};
}
export function loadConfig(file,{execute=false,now=new Date()}={}){
 file=path.resolve(file);const dir=path.dirname(file),auth=JSON.parse(fs.readFileSync(file,'utf8'));
 if(auth.schemaVersion!==2)throw Error('需要 schemaVersion=2 的本轮配置；历史授权仅用于对账');
 if(typeof auth.runId!=='string'||!auth.runId||typeof auth.runDirectory!=='string'||!auth.runDirectory||!Array.isArray(auth.profiles)||!auth.profiles.length)throw Error('缺少 runId、runDirectory 或 profiles');
 if(!Array.isArray(auth.actions)||!auth.actions.length||new Set(auth.actions).size!==auth.actions.length||auth.actions.some(a=>!['greet','request','accept'].includes(a)))throw Error('阶段必须为 greet/request/accept');
 if(auth.actions.join(',')!==['greet','request','accept'].filter(a=>auth.actions.includes(a)).join(','))throw Error('阶段顺序必须为打招呼、求简历、收简历');
 if(execute&&(!auth.approval?.source||!auth.actions.every(a=>auth.approval.actions?.includes(a))))throw Error('本轮实际操作没有对应授权来源和动作');
 if(execute&&auth.businessDate!==businessDate(now))throw Error('本轮授权日期不符，不复用历史授权');
 if(auth.deadline&&(!Number.isFinite(Date.parse(auth.deadline))||Date.parse(auth.deadline)<=+now))throw Error('截止时间无效或已过期');
 const runtimeFile=path.resolve(dir,auth.runtimeFile||path.join(ROOT,'runtime.local.json'));
 const runtime=JSON.parse(fs.readFileSync(runtimeFile,'utf8'));
 const sources=new Set([file,runtimeFile]);let bindings=[];
 for(const ref of auth.profiles){
  const profileFile=path.resolve(dir,ref),loaded=readProfile(profileFile);
  loaded.files.forEach(f=>sources.add(f));
  const check=spawnSync(runtime.pythonExecutable||'python3',[path.join(ROOT,'scripts/boss_template.py'),'validate','--profile',profileFile],{encoding:'utf8',timeout:10000});
  if(check.status!==0)throw Error('画像校验失败：'+(check.stderr||profileFile));
  const ruleHash=JSON.parse(check.stdout).ruleHash;
  for(const b of loaded.profile.jobBindings){
   if(typeof b.jobId!=='string'||!b.jobId||['undefined','null'].includes(b.jobId)||!b.label)throw Error('岗位需要稳定 ID 和完整标签');
   bindings.push({...b,conversationTitle:String(b.conversationTitle||b.label.split(' _ ')[0]).replace(/\s+/g,' ').trim(),profileFile,profileId:loaded.profile.profileId,ruleHash,
    greetingText:auth.greetings?.[b.jobId]||auth.greeting||loaded.profile.greeting?.text||''});
  }
 }
 if(auth.jobIds){
  if(!Array.isArray(auth.jobIds)||new Set(auth.jobIds).size!==auth.jobIds.length)throw Error('授权岗位 ID 不能重复');
  bindings=bindings.filter(b=>auth.jobIds.includes(b.jobId));
  if(bindings.length!==auth.jobIds.length)throw Error('授权岗位不在画像绑定中');
 }
 if(!bindings.length||new Set(bindings.map(b=>b.jobId)).size!==bindings.length)throw Error('岗位绑定缺失或同一岗位重复绑定画像');
 const controls={batchSize:5,betweenActionsMs:10000,batchPauseMs:120000,maxScan:1000,maxListItems:10000,maxLoadPasses:400,maxHistoryLoads:150,maxConversations:1000,maxAcceptPasses:3,...auth.controls};
 for(const k of Object.keys(controls))if(!Number.isInteger(controls[k])||controls[k]<(k.endsWith('Ms')?0:1))throw Error('运行参数无效：'+k);
 const budgets={greet:0,request:0,accept:0,...auth.budgets};
 for(const a of auth.actions)if(!Number.isInteger(budgets[a])||budgets[a]<(execute?1:0))throw Error('阶段预算缺失或无效：'+a);
 if(auth.actions.includes('greet')){
  if(bindings.some(b=>!b.greetingText))throw Error('发送配置必须有实际话术');
  if(execute&&budgets.greet>1&&!auth.firstGreetingVerified)throw Error('批量发送前须完成首条实际话术读回；先用独立单条试验配置');
 }
 if(auth.actions.some(a=>a!=='greet')){
  if(!['all_history','since','conversation_allowlist'].includes(auth.resumeScope?.mode))throw Error('简历范围必须明确配置');
  if(auth.resumeScope.mode==='since'&&!Number.isFinite(Date.parse(auth.resumeScope.since)))throw Error('简历起始时间无效');
  if(auth.resumeScope.mode==='conversation_allowlist'&&(!auth.resumeScope.conversationFingerprints?.length||auth.resumeScope.conversationFingerprints.some(x=>!/^([a-f0-9]{64})$/.test(x))))throw Error('本轮会话白名单必须为稳定会话编号的指纹');
  if(execute&&auth.resumeScope.mode==='all_history'&&!auth.approval.allHistory)throw Error('全部历史范围必须有当前用户明确授权');
 }
 for(const f of fs.readdirSync(path.join(ROOT,'scripts')))if(/\.(mjs|py)$/.test(f))sources.add(path.join(ROOT,'scripts',f));
 const fileHashes=Object.fromEntries([...sources].map(f=>[f,hash(fs.readFileSync(f))]));
 const cfg={auth,runtime,bindings,controls,budgets,execute,runDir:path.resolve(dir,auth.runDirectory),fileHashes};
 cfg.assertFrozen=()=>{
  if(cfg.cancelled)throw Error('用户请求停止');
  if(auth.deadline&&Date.now()>=Date.parse(auth.deadline))throw Error('到达用户截止时间');
  if(execute&&businessDate(new Date())!==auth.businessDate)throw Error('跨日停止；保留历史，新一日需新配置');
  if(Object.entries(fileHashes).some(([f,h])=>hash(fs.readFileSync(f))!==h))throw Error('代码或配置在运行期间发生变化');
 };
 return cfg;
}
export function matchesResumeScope(row,cfg){
 if(!row.id||['undefined','null'].includes(String(row.id)))return false;
 const binding=cfg.bindings.find(b=>b.jobId===row.jobId);
 if(!binding||String(row.job).replace(/\s+/g,' ').trim()!==binding.conversationTitle)return false;
 const scope=cfg.auth.resumeScope;
 if(scope.mode==='all_history')return true;
 if(scope.mode==='conversation_allowlist')return scope.conversationFingerprints.includes(hash(String(row.id)));
 return Number.isFinite(row.time)&&row.time>=Date.parse(scope.since);
}
export function writeJson(file,data){
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.tmp';
 fs.writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);
}
export function appendEvent(file,event){
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const fd=fs.openSync(file,'a',0o600);
 try{fs.writeSync(fd,JSON.stringify({at:new Date().toISOString(),...event})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
