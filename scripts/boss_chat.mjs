// Core UI operations extracted from the local legacy resume runner.
// No role-name filters, historical date, offset slicing or legacy browser guards.
import {hash} from './boss_config.mjs';
import {wait as sleep} from './boss_platform.mjs';
export function createChatAdapter(session,cfg,emit=()=>{}){
 const summary={reachedEnd:false,listCount:0,requested:0,accepted:0};
 async function safe(){await session.guard();cfg.assertFrozen();if(cfg.cancelled)throw Error('用户请求停止');}
async function inventory(page){
 await safe(page);
 let stagnant=0,last=-1;summary.reachedEnd=false;
 for(let i=0;i<cfg.controls.maxLoadPasses;i++){
  const s=await page.evaluate(()=>{const v=document.querySelector('.chat-user')?.__vue__,list=document.querySelector('.user-list.b-scroll-stable');if(!v||!list)throw Error('Missing communication list');return {count:v.list$?.length,more:v.hasMore$,loading:v.loading$,foot:document.body.innerText.includes('没有更多了')}});
  if(s.count>cfg.controls.maxListItems)throw Error('沟通列表达到读取预算，未完成');
  if(s.more===false&&!s.loading){summary.reachedEnd=true;break}
  if(s.count===last)stagnant++;else stagnant=0;
  if(stagnant>15)throw Error('沟通列表未确认完整加载，停止');last=s.count;
  await page.evaluate(()=>{const el=document.querySelector('.user-list.b-scroll-stable');el.scrollTop=el.scrollHeight;const more=[...document.querySelectorAll('.chat-user div,.chat-user span')].find(e=>e.textContent.trim()==='滚动加载更多');more?.click()});
  await sleep(700);await safe(page);
  if(i%20===0)emit({type:'list_loading',count:s.count});
 }
 if(!summary.reachedEnd)throw Error('未加载全部沟通列表');
 const rows=await page.evaluate(()=>document.querySelector('.chat-user').__vue__.list$.map(r=>({id:String(r.uniqueId),job:r.jobName||'',time:Number(r.lastTS),jobId:r.encryptJobId||''})));
 summary.listCount=rows.length;emit({type:'inventory',count:rows.length,reachedEnd:true});return rows;
}
async function identity(page,row){
 return await page.evaluate(({id,job,jobId})=>{
 const u=document.querySelector('.chat-user')?.__vue__?.currentData$;
 const c=document.querySelector('.chat-message-list .message-item')?.__vue__?.conversation;
 const label=document.querySelector('.base-info-single-container .position-item .position-name')?.textContent.replace(/\s+/g,' ').trim() ?? document.querySelector('.chat-conversation .position-name')?.textContent.replace(/\s+/g,' ').trim();
 return String(u?.uniqueId)===id&&String(c?.uniqueId)===id&&u?.jobName===job&&String(u?.encryptJobId)===jobId&&label===job;
 },row);
}
async function open(page,row){
 await safe(page);
 for(let i=0;i<8;i++){
  const result=await page.evaluate(({id,job,jobId})=>{
   const v=document.querySelector('.chat-user').__vue__,arr=v.list$,index=arr.findIndex(r=>String(r.uniqueId)===id);
   if(index<0||(arr[index].jobName!==job||String(arr[index].encryptJobId)!==jobId))return 'missing';
   const el=[...document.querySelectorAll('.geek-item')].find(e=>e.dataset.id===id);
   if(el){if(el.querySelector('.source-job')?.textContent.trim()!==job)return 'mismatch';el.click();return 'clicked'}
   const list=document.querySelector('.user-list.b-scroll-stable');const wrap=document.querySelector('.geek-item-wrap');list.scrollTop=index*(wrap?.getBoundingClientRect().height||78);return 'scroll';
  },row);
  if(result==='clicked')break;if(result==='missing'||result==='mismatch')throw Error('列表会话岗位/身份不一致');await sleep(200);
 }
 const end=Date.now()+30000;while(Date.now()<end){if(await identity(page,row))break;await sleep(180);await safe(page)}
 if(!await identity(page,row))throw Error('打开后会话稳定ID/沟通岗位无法核对');
 for(let round=0;round<cfg.controls.maxHistoryLoads;round++){
  const top=await page.evaluate(()=>{const l=document.querySelector('.chat-message-list');if(l?.classList.contains('is-to-top'))return true;const sc=document.querySelector('.conversation-message');if(sc)sc.scrollTop=0;return false});
  if(top)return;await sleep(220);await safe(page);
 }
 throw Error('聊天记录未确认到最早一条');
}
async function state(page,row){
 if(!await identity(page,row))throw Error('会话已切换，停止');
 return await page.evaluate(()=>{
  const norm=v=>(v||'').replace(/\s+/g,' ').trim();
  const disabled=e=>!e||/disabled|forbid|ban/.test(e.className)||e.hasAttribute('disabled')||getComputedStyle(e).pointerEvents==='none'||Number(getComputedStyle(e).opacity)<0.35;
  const items=[...document.querySelectorAll('.chat-message-list .message-item')];
  const pending=[],attachments=[],unrecognizedResumeCards=[];
  for(const item of items){const f=item.querySelector('.item-friend');if(!f)continue;const mid=String(item.__vue__?.message?.mid||'');const title=norm(f.querySelector('.message-card-top-title')?.textContent);const b=[...f.querySelectorAll('.message-card-buttons .card-btn')].find(b=>norm(b.textContent)==='同意');
   if(/对方想发送.*附件简历.*是否同意/.test(title)&&b&&!disabled(b)){if(!mid)throw Error('附件卡片缺少稳定消息ID');pending.push(mid)}
   else if(/附件简历/.test(title)&&b&&!disabled(b))unrecognizedResumeCards.push(mid||'missing-message-id');
   if(f.querySelector('.resume-icon')||/点击预览附件简历|简历已接收/.test(norm(f.textContent)))attachments.push(mid);
  }
  const onlineResume=items.some(i=>/在线简历已接收|对方已发送在线简历/.test(norm(i.querySelector('.item-friend')?.textContent)));
  const doNotContact=items.some(i=>/不要再联系|别再联系|请勿打扰/.test(norm(i.querySelector('.item-friend')?.textContent)));
  const requested=items.some(i=>/方便发一份(?:你的)?简历过来吗|简历请求已发送/.test(norm(i.querySelector('.item-myself')?.textContent)));
  const host=[...document.querySelectorAll('.operate-icon-item')].find(e=>norm(e.querySelector('.operate-btn')?.textContent)==='求简历');const b=host?.querySelector('.operate-btn');
  const conversation=items[0]?.__vue__?.conversation;
  return {pending,attachments,unrecognizedResumeCards,onlineResume,doNotContact,requested:requested||conversation?.requestResume===true,buttonExists:!!host&&!!b,buttonDisabled:!!host&&!!b&&(disabled(host)||disabled(b)),available:!!host&&!disabled(host)&&!disabled(b),confirmOpen:[...document.querySelectorAll('.exchange-tooltip')].some(e=>e.getBoundingClientRect().width>0&&/请求简历|索取简历/.test(e.textContent))};
 });
}
async function request(page,row,before){
 await safe(page);if(!await identity(page,row))throw Error('请求前身份不明');
 const clicked=await page.evaluate(()=>{const e=[...document.querySelectorAll('.operate-icon-item .operate-btn')].find(e=>e.textContent.trim()==='求简历');if(!e)return false;e.click();return true});if(!clicked)throw Error('求简历按钮不存在');
 await page.waitForFunction(()=>[...document.querySelectorAll('.exchange-tooltip')].some(e=>e.getBoundingClientRect().width>0&&/确定向牛人(?:请求|索取)简历(?:吗)?[？?]?/.test(e.innerText)),{timeout:8000});
 if(!await identity(page,row))throw Error('确认前会话身份不一致');
 const detail=await page.evaluate(()=>{const e=[...document.querySelectorAll('.exchange-tooltip')].find(e=>e.getBoundingClientRect().width>0&&/确定向牛人(?:请求|索取)简历(?:吗)?[？?]?/.test(e.innerText));return e?.innerText||''});
 if(!/^确定向牛人(?:请求|索取)简历(?:吗)?[？?]?\s*取消\s*确定$/.test(detail.trim())&&!/方便发一份(?:你的)?简历过来吗/.test(detail))throw Error('求简历默认确认内容不匹配');
 emit({type:'request_intent',fingerprint:hash(row.id)});
 const confirmed=await page.evaluate(row=>{
  const u=document.querySelector('.chat-user')?.__vue__?.currentData$,c=document.querySelector('.chat-message-list .message-item')?.__vue__?.conversation;
  if(String(u?.uniqueId)!==row.id||String(c?.uniqueId)!==row.id||String(u?.encryptJobId)!==row.jobId||u?.jobName!==row.job)return false;
  const dialogs=[...document.querySelectorAll('.exchange-tooltip')].filter(e=>e.getBoundingClientRect().width>0&&/确定向牛人(?:请求|索取)简历(?:吗)?[？?]?/.test(e.innerText));
  if(dialogs.length!==1)return false;const b=dialogs[0].querySelector('.boss-btn-primary');
  if(b?.textContent.trim()!=='确定'||b.disabled||/disabled/.test(b.className))return false;
  b.click();return true;
 },row);if(!confirmed)throw Error('确认时身份或按钮变化，不补点');
 for(let i=0;i<20;i++){await sleep(250);const s=await state(page,row);if(!s.confirmOpen&&s.requested){summary.requested++;emit({type:'requested',fingerprint:hash(row.id)});return}}
 throw Error('求简历点击后结果未确认，禁止重发');
}
async function accept(page,row,mid,before){
 await safe(page);if(!await identity(page,row))throw Error('同意前身份不明');emit({type:'accept_intent',fingerprint:hash(row.id),messageFingerprint:hash(mid)});
 const clicked=await page.evaluate(({row,mid})=>{
  const u=document.querySelector('.chat-user')?.__vue__?.currentData$,c=document.querySelector('.chat-message-list .message-item')?.__vue__?.conversation;
  if(String(u?.uniqueId)!==row.id||String(c?.uniqueId)!==row.id||String(u?.encryptJobId)!==row.jobId||u?.jobName!==row.job)return false;
  const items=[...document.querySelectorAll('.chat-message-list .message-item')].filter(e=>String(e.__vue__?.message?.mid)===mid);
  if(items.length!==1)return false;const f=items[0].querySelector('.item-friend');
  if(!/对方想发送.*附件简历.*是否同意/.test(f?.querySelector('.message-card-top-title')?.textContent||''))return false;
  const buttons=[...f.querySelectorAll('.card-btn')].filter(e=>e.textContent.trim()==='同意'&&!/disabled|forbid|ban/.test(e.className)&&!e.hasAttribute('disabled')&&getComputedStyle(e).pointerEvents!=='none');
  if(buttons.length!==1)return false;buttons[0].scrollIntoView({block:'center'});buttons[0].click();return true;
 },{row,mid});
 if(!clicked)throw Error('待同意简历卡片发生变化');
 for(let i=0;i<80;i++){await sleep(250);const s=await state(page,row);if(!s.pending.includes(mid)&&s.attachments.some(id=>id===mid||!before.attachments.includes(id))){summary.accepted++;emit({type:'accepted',fingerprint:hash(row.id),messageFingerprint:hash(mid)});return}}
 throw Error('同意后未确认新增附件，停止且不重复点击');
}

 return {
  async prepare(){
   await session.go('https://www.zhipin.com/web/chat/index','/web/chat/index');
   const page=session.page;await page.waitForSelector('.chat-user',{timeout:15000});
   await page.evaluate(()=>{
    const e=[...document.querySelectorAll('.chat-label-item')].find(e=>e.textContent.trim()==='全部');
    if(e&&!/selected|active/.test(e.className))e.click();
    const f=[...document.querySelectorAll('.chat-message-filter-left span')].find(e=>e.textContent.trim()==='全部');
    if(f&&!/selected|active/.test(f.className))f.click();
   });
   await page.waitForFunction(()=>[...document.querySelectorAll('.chat-label-item')].some(e=>e.textContent.trim()==='全部'&&/selected|active/.test(e.className))&&[...document.querySelectorAll('.chat-message-filter-left span')].some(e=>e.textContent.trim()==='全部'&&/selected|active/.test(e.className))&&document.querySelector('.chat-user')?.__vue__?.list$,{timeout:15000});
   await safe();
  },
  async inventory(){const rows=await inventory(session.page);if(rows.some(r=>!r.id||['undefined','null'].includes(r.id))||new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('沟通列表编号缺失或重复');return {rows,reachedEnd:summary.reachedEnd};},
  open:row=>open(session.page,row),state:row=>state(session.page,row),
  request:(row,before)=>request(session.page,row,before),
  accept:(row,mid,before)=>accept(session.page,row,mid,before),
  async confirmationOpen(){return session.page.evaluate(()=>[...document.querySelectorAll('.exchange-tooltip')].some(e=>e.getBoundingClientRect().width>0&&/请求简历|索取简历/.test(e.textContent)));},
  guard:safe
 };
}
