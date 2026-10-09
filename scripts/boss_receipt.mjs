// Observe normal UI traffic. The endpoint/schema are retained from the uploaded
// helper; current production compatibility still requires an observed UI receipt.
export function matchesGreetingRequest(request, candidateId, jobId) {
  try {
    const url = new URL(request.url());
    if (url.origin !== 'https://www.zhipin.com' || url.pathname !== '/wapi/zpjob/chat/start' || request.method() !== 'POST') return false;
    let data;
    const raw = request.postData() || '';
    try { data = JSON.parse(raw); } catch { data = Object.fromEntries(new URLSearchParams(raw)); }
    return typeof data === 'object' && data !== null && !Array.isArray(data) && String(data.gid) === String(candidateId) && String(data.jid) === String(jobId);
  } catch { return false; }
}
export async function clickWithPlatformReceipt({page,frame,candidate,jobId,click,onClicked,writeEvent,timeoutMs=12000}) {
  if (!candidate.geekId || !jobId) throw new Error('缺少候选人或岗位稳定 ID，停止点击');
  let armed = false, selectedRequest, resolveRequest, resolveResponse, rejectTransport, timer;
  const requestPromise = new Promise(resolve => { resolveRequest = resolve; });
  const responsePromise = new Promise(resolve => { resolveResponse = resolve; });
  const transportPromise = new Promise((_,reject) => { rejectTransport = reject; });
  transportPromise.catch(() => {});
  const responseListener = response => {
    try { if (selectedRequest && response.request() === selectedRequest) resolveResponse(response); }
    catch { rejectTransport(new Error('无法关联招呼响应，结果未知，禁止重发')); }
  };
  const requestListener = request => {
    if (armed && !selectedRequest && matchesGreetingRequest(request,candidate.geekId,jobId)) {
      selectedRequest = request;
      writeEvent('request_observed',{matchedCandidateAndJob:true});
      resolveRequest(request);
    }
  };
  const failedListener = request => {
    if (!selectedRequest || request !== selectedRequest) return;
    let networkError = 'unavailable';
    try { networkError = String(request.failure()?.errorText || '').match(/net::[A-Z0-9_]+/)?.[0] || 'unavailable'; } catch {}
    try { writeEvent('request_failed',{networkError}); }
    catch { /* the outer catch will attempt to persist unresolved state */ }
    rejectTransport(new Error(`招呼请求传输失败：${networkError}；结果未知，禁止重发`));
  };
  const deadline = new Promise((_,reject) => {
    timer = setTimeout(() => reject(new Error('点击/平台回执超时，结果未知，禁止重发')),timeoutMs);
  });
  deadline.catch(() => {});
  const wait = promise => Promise.race([promise,deadline,transportPromise]);
  const scalar = value => typeof value === 'number' || typeof value === 'boolean' ? value : typeof value === 'string' ? value.slice(0,40) : null;
  page.on('request',requestListener);
  page.on('response',responseListener);
  page.on('requestfailed',failedListener);
  try {
    writeEvent('intent');
    armed = true;
    await wait(click(frame,{name:candidate.name,geekId:candidate.geekId}));
    onClicked();
    writeEvent('clicked');
    await wait(requestPromise);
    const response = await wait(responsePromise);
    if (!response) throw new Error('招呼请求未收到响应，结果未知，禁止重发');
    const base = {path:new URL(response.url()).pathname,httpStatus:response.status()};
    if (base.httpStatus !== 200) {
      writeEvent('unconfirmed',base);
      throw new Error(`招呼回应HTTP ${base.httpStatus}，未确认新沟通，禁止重发`);
    }
    let body;
    try { body = await wait(response.json()); }
    catch(error) { writeEvent('body_unavailable',base); throw error; }
    const data = body?.zpData;
    const receipt = {...base,businessCode:scalar(body?.code),status:scalar(data?.status),newfriend:scalar(data?.newfriend)};
    // Keep the original strict success contract, including blocked/dialog flows.
    if (body?.code !== 0 || data?.newfriend !== 1 || data?.status !== 1 || data?.blockPageData || data?.greetingInfo?.guideTip) {
      writeEvent('unconfirmed',receipt);
      throw new Error('招呼回应未明确确认新沟通，须官方核对，禁止重发');
    }
    writeEvent('acknowledged',receipt);
    return {clicked:true,acknowledged:true,receipt};
  } catch(error) {
    if(error?.code==='BOSS_GREET_PRECLICK_ABORT'&&!selectedRequest){writeEvent('not_clicked',{reason:error.preClickKind});throw error;}
    if (error?.code === 'BOSS_GREET_PRECLICK_MISSING' && ['empty','not_found'].includes(error.preClickKind) && !selectedRequest) {
      writeEvent('not_clicked',{reason:error.preClickKind});
      return {clicked:false,acknowledged:false,notClicked:true,reason:error.preClickKind};
    }
    writeEvent('unresolved',{reason:String(error?.message || error).slice(0,200)});
    throw error;
  } finally {
    armed = false;
    clearTimeout(timer);
    page.off('request',requestListener);
    page.off('response',responseListener);
    page.off('requestfailed',failedListener);
  }
}
