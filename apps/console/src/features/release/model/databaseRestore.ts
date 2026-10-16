import type {DatabaseRestoreDto} from '@crewstation/contracts';
import {DatabaseRestoreStageSchema} from '@crewstation/contracts';
import type {Progress} from '../../../shared/ui/progress/stageProgressView';
export function restoreProgress(op:DatabaseRestoreDto):Progress{
 const stages=DatabaseRestoreStageSchema.options,index=stages.indexOf(op.stage);
 return {state:op.error?'failed':op.stage==='completed'?'ready':'running',stages:stages.map((kind,n)=>({kind,state:n<index||op.stage==='completed'?'succeeded':n===index?op.error?'failed':'running':'pending'}))};
}
export function parseRestoreSearch(raw:Record<string,unknown>){return {filter:typeof raw.filter==='string'&&DatabaseRestoreStageSchema.safeParse(raw.filter).success?raw.filter:undefined};}
export function sameRestoreConfirmation(current:DatabaseRestoreDto,review:DatabaseRestoreDto){return current.id===review.id&&current.revision===review.revision&&!!current.confirmationDigest&&current.confirmationDigest===review.confirmationDigest&&current.actions.includes('switch');}
