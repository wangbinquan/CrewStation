import type { Actor, ApproveDatabaseMigration, CreateDatabaseMigration, RetryDatabaseMigration, ServiceId, SwitchDatabaseMigration } from '@crewstation/contracts';
import { conflict, newResourceId } from '@crewstation/kernel';
import type { DatabaseMigrationOperation } from '../../domain/database-migration/operation';
import { migrationActions, migrationConfirmation, migrationDto } from '../../domain/database-migration/operation';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { migrationContext } from './context';
import { retryMigrationBuild } from './build';
import { createDatabaseMigration } from './create';
const attempts=(op:DatabaseMigrationOperation)=>op.currentAttempt?[...op.previousAttempts,op.currentAttempt]:op.previousAttempts;
export function databaseMigrationCommands(deps:ReleaseUseCaseDeps){
 const view=async(actor:Actor,op:DatabaseMigrationOperation)=>({...migrationDto(op),...(!actor.isAdmin||!await migrationContext(deps).support.isAdmin(actor.userId)?{actions:[]}: {})});
 const change=async(actor:Actor,serviceId:ServiceId,id:string,input:RetryDatabaseMigration,action:ReturnType<typeof migrationActions>[number],effect:(op:DatabaseMigrationOperation)=>Promise<DatabaseMigrationOperation>)=>{
  const c=migrationContext(deps);await c.authorize(actor,serviceId);
  return c.work(serviceId,id,{action,input,actor:actor.userId},async()=>{const op=await c.load(serviceId,id);
   if(op.revision!==input.expectedRevision)throw conflict('迁移操作已变化，请重新核对',{code:'stale_revision'});
   if(!migrationActions(op).includes(action))throw conflict('当前阶段不允许此动作',{code:'database_migration_invalid_stage'});
   return migrationDto(await effect(op));
  });
 };
 return {
  listDatabaseMigrations:async(actor:Actor,id:ServiceId)=>{const c=migrationContext(deps);await c.authorize(actor,id,false);return {items:await Promise.all((await c.store.list(id)).map(op=>view(actor,op)))};},
  getDatabaseMigration:async(actor:Actor,serviceId:ServiceId,id:string)=>{const c=migrationContext(deps);await c.authorize(actor,serviceId,false);return view(actor,await c.load(serviceId,id));},
  createDatabaseMigration:(actor:Actor,id:ServiceId,input:CreateDatabaseMigration)=>createDatabaseMigration(deps,actor,id,input),
  replanDatabaseMigration:(actor:Actor,s:ServiceId,id:string,input:RetryDatabaseMigration)=>change(actor,s,id,input,'replan',op=>migrationContext(deps).save(op,{stage:'planning',plan:null,approval:null,previousAttempts:attempts(op),currentAttempt:null})),
  approveDatabaseMigration:(actor:Actor,s:ServiceId,id:string,input:ApproveDatabaseMigration)=>change(actor,s,id,input,'approve',async op=>{
   if(op.plan?.plan.approvalDigest!==input.approvalDigest)throw conflict('批准摘要已变化',{code:'database_migration_approval_mismatch'});
   if(op.plan.plan.payload.blocks.length)throw conflict('计划仍有阻断项',{code:'database_migration_plan_blocked'});
   return migrationContext(deps).save(op,{stage:op.stage==='awaiting-reapproval'?'migrating':'approved',approval:{digest:input.approvalDigest,by:actor.userId,at:deps.clock.now().toISOString()},...(op.stage==='awaiting-reapproval'?{previousAttempts:attempts(op),currentAttempt:null}: {})});
  }),
  switchDatabaseMigration:(actor:Actor,s:ServiceId,id:string,input:SwitchDatabaseMigration)=>change(actor,s,id,input,'switch',async op=>{
   if(migrationConfirmation(op)!==input.confirmationDigest)throw conflict('切换确认已过期',{code:'database_migration_confirmation_mismatch'});
   const binding=await migrationContext(deps).database.active(s,'production'),slots=await deps.uow.read.slots.get(s);
   if(binding.generationId!==op.sourceGenerationId||binding.revision!==op.sourceBindingRevision||binding.migrationOperationId!==op.id||slots?.[slots.active].releaseId!==op.sourceReleaseId)throw conflict('原生产版本或世代已变化');
   return migrationContext(deps).save(op,{stage:'freezing',switchActor:actor});
  }),
  openDatabaseMigration:(actor:Actor,s:ServiceId,id:string,input:SwitchDatabaseMigration)=>change(actor,s,id,input,'open',async op=>{
   if(migrationConfirmation(op)!==input.confirmationDigest)throw conflict('开放确认已过期',{code:'database_migration_confirmation_mismatch'});
   return migrationContext(deps).save(op,{stage:'opening',switchActor:actor});
  }),
  rollbackDatabaseMigration:(actor:Actor,s:ServiceId,id:string,input:RetryDatabaseMigration)=>change(actor,s,id,input,'rollback',op=>migrationContext(deps).save(op,{stage:'rolling-back',error:null,observation:null,switchActor:actor})),
  abandonDatabaseMigration:(actor:Actor,s:ServiceId,id:string,input:RetryDatabaseMigration)=>change(actor,s,id,input,'abandon',op=>migrationContext(deps).save(op,{abandonRequested:true,error:null,switchActor:actor})),
  retryDatabaseMigration:(actor:Actor,s:ServiceId,id:string,input:RetryDatabaseMigration)=>change(actor,s,id,input,'retry',async op=>{if(op.stage==='building')await retryMigrationBuild(deps,op);return migrationContext(deps).save(op,{error:null,observation:null,...(!['requested','provisioning','building','planning','awaiting-approval','approved'].includes(op.stage)?{switchActor:actor}:{}),...(op.currentAttempt?.proof?.receipt.state==='failed'?{previousAttempts:attempts(op),currentAttempt:{jobId:newResourceId(),purpose:op.currentAttempt.purpose,proof:null,receiptDigest:null}}:{})});}),
 };
}
