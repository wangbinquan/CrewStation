import { DatabaseMigrationStageSchema } from '@crewstation/contracts';
import type { DatabaseMigrationDto, DatabaseMigrationAction } from '@crewstation/contracts';
import type { Progress } from '../../../../shared/ui/progress/stageProgressView';
export const migrationFinished=(op:DatabaseMigrationDto|undefined)=>!!op&&['completed','rolled-back','abandoned'].includes(op.stage);
export function parseMigrationSearch(raw:Record<string,unknown>){return {filter:typeof raw.filter==='string'&&DatabaseMigrationStageSchema.safeParse(raw.filter).success?raw.filter:undefined};}
export function sameMigrationConfirmation(current:DatabaseMigrationDto,review:DatabaseMigrationDto,action:DatabaseMigrationAction){return current.id===review.id&&current.revision===review.revision&&current.actions.includes(action)&&current.confirmationDigest===review.confirmationDigest&&current.plan?.plan.approvalDigest===review.plan?.plan.approvalDigest;}
export function migrationProgress(op:DatabaseMigrationDto):Progress{
 if(['abandoned','rolled-back','rolling-back'].includes(op.stage))return {state:op.stage==='rolling-back'?'running':'cancelled',stages:[{kind:op.stage,state:op.stage==='rolling-back'?'running':'succeeded'}]};
 const stages=DatabaseMigrationStageSchema.options.filter(s=>!['abandoned','rolled-back','rolling-back','awaiting-reapproval'].includes(s)),index=stages.indexOf(op.stage==='awaiting-reapproval'?'migrating':op.stage);
 return {state:op.error?'failed':op.stage==='completed'?'ready':'running',stages:stages.map((kind,n)=>({kind,state:n<index||op.stage==='completed'?'succeeded':n===index?op.error?'failed':'running':'pending'}))};
}
