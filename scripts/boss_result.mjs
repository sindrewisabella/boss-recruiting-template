import {businessDate} from './boss_config.mjs';
export function reconcileGreetings(result,after){
 const base=result.baseline;
 if(!base||businessDate(new Date(base.observedAt))!==businessDate(new Date(after.observedAt)))throw Error('官方基线与结束值必须在同一香港日期');
 result.latestOfficial=after;
 result.officialDelta=after.greeted-base.greeted;
 result.quotaRemainingFromReceipts=Number.isFinite(result.invocationInitialRemaining)&&Number.isFinite(result.invocationConfirmed)?Math.max(0,result.invocationInitialRemaining-result.invocationConfirmed):Number.isFinite(base.remaining)?Math.max(0,base.remaining-result.confirmed):null;
 result.officialRemaining=after.remaining;
 result.entitlementDelta=base.entitlementLimit===after.entitlementLimit?after.entitlementUsed-base.entitlementUsed:null;
 result.entitlementComparable=base.entitlementLimit===after.entitlementLimit;
 result.officialReconciled=result.officialDelta===result.confirmed&&result.unknown===0;
 result.status=!result.officialReconciled?'reconciliation_mismatch':result.confirmed>=result.target?'complete':after.remaining===0?'quota_exhausted':result.status==='running'?'partial':result.status;
 return result;
}
export function workflowStatus(stages,actions){
 return actions.every(a=>stages[a]?.status==='complete')?'complete':actions.some(a=>['stopped','reconciliation_mismatch'].includes(stages[a]?.status))?'stopped':'partial';
}
