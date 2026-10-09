import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {matchesGreetingRequest,clickWithPlatformReceipt} from './boss_receipt.mjs';
const request=(id='candidate-A',job='job-A',method='POST')=>({url:()=> 'https://www.zhipin.com/wapi/zpjob/chat/start',method:()=>method,postData:()=>JSON.stringify({gid:id,jid:job})});
assert.equal(matchesGreetingRequest(request(),'candidate-A','job-A'),true);
assert.equal(matchesGreetingRequest(request('candidate-B'),'candidate-A','job-A'),false);
assert.equal(matchesGreetingRequest(request('candidate-A','job-B'),'candidate-A','job-A'),false);
assert.equal(matchesGreetingRequest(request('candidate-A','job-A','GET'),'candidate-A','job-A'),false);
async function trial({body={code:0,zpData:{status:1,newfriend:1}},status=200,missing=false,changed=false,noTraffic=false}={}){
 const page=new EventEmitter(),stages=[];let calls=0;
 const task=clickWithPlatformReceipt({page,frame:{},candidate:{geekId:'candidate-A'},jobId:'job-A',timeoutMs:40,onClicked:()=>{},writeEvent:stage=>stages.push(stage),click:async()=>{calls++;if(missing)throw Object.assign(Error('gone'),{code:'BOSS_GREET_PRECLICK_MISSING',preClickKind:'not_found'});if(changed)throw Object.assign(Error('facts changed'),{code:'BOSS_GREET_PRECLICK_ABORT',preClickKind:'facts_changed'});if(noTraffic)return;const req=request();page.emit('request',req);page.emit('response',{request:()=>req,url:req.url,status:()=>status,json:async()=>body});}});
 try{return {result:await task,stages,calls};}catch(error){return {error,stages,calls};}
}
let r=await trial();assert.equal(r.result.acknowledged,true);assert.deepEqual(r.stages,['intent','request_observed','clicked','acknowledged']);
for(const options of [{status:403},{body:{code:32}},{body:{code:0,zpData:{status:1,newfriend:0}}},{noTraffic:true}]){r=await trial(options);assert.ok(r.error);assert.equal(r.calls,1);assert.ok(r.stages.includes('unresolved'));assert.ok(!r.stages.includes('acknowledged'));}
r=await trial({missing:true});assert.equal(r.result.notClicked,true);assert.ok(!r.stages.includes('unresolved'));
r=await trial({changed:true});assert.ok(r.error);assert.ok(r.stages.includes('not_clicked'));assert.ok(!r.stages.includes('clicked'));assert.ok(!r.stages.includes('unresolved'));
console.log('PASS: 回执关联岗位与人选；HTTP200不等于成功；旧会话／403／超时不确认且不重试；未点击与未知区分。');
