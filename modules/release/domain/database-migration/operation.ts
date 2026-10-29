import type { Actor, DatabaseMigrationDto, DatabaseMigrationJobPurpose, DatabaseMigrationPlanView, DatabaseMigrationReceipt, Manifest, MigrationPrepared } from '@crewstation/contracts';
import { DatabaseMigrationDtoSchema } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import type { RestoreJobProof } from '../databaseRestore';
export interface MigrationJobProof extends RestoreJobProof { output?: { kind: 'plan'|'receipt'; text: string }; logTail?: string }
export interface MigrationAttempt { jobId: string; purpose: DatabaseMigrationJobPurpose; proof: MigrationJobProof | null; receiptDigest: string | null }
export interface DatabaseMigrationOperation extends Omit<DatabaseMigrationDto,'actions'|'blockedReason'|'confirmationDigest'|'attempts'> {
  requestDigest: string; sourceBindingRevision: number; targetSlot: 'blue'|'green'; manifest: Manifest | null;
  environmentBox: string | null; environmentVersion: number | null;
  currentAttempt: MigrationAttempt | null; previousAttempts: MigrationAttempt[];
  prepared: MigrationPrepared | null; rollbackRequest: string | null;
  freeze: { reference: string; epoch: number; digest: string } | null;
  switchActor: Actor | null; maintenanceRevision: number | null;
  candidateProof: { deploymentUid: string; secretUid: string; environmentDigest: string } | null;
  receipts: Partial<Record<'run'|'verify'|'rollback'|'complete', DatabaseMigrationReceipt>>;
  abandonRequested: boolean;
}
export const migrationOperationKey = (id:string) => 'dbm_e2_'+id.replaceAll('-','');
export const migrationEnded = (op:Pick<DatabaseMigrationOperation,'stage'>) => ['completed','rolled-back','abandoned'].includes(op.stage);
export const migrationBeforeFreeze = (op:Pick<DatabaseMigrationOperation,'stage'>) => ['requested','provisioning','building','planning','awaiting-approval','approved'].includes(op.stage);
export const migrationRollbackAllowed = (op:Pick<DatabaseMigrationOperation,'stage'>) => ['freezing','migrating','awaiting-reapproval','activating','verifying','ready-to-open'].includes(op.stage);
export function migrationConfirmation(op:DatabaseMigrationOperation):string|null {
  if(op.error||!['approved','ready-to-open'].includes(op.stage)||!op.plan||!op.approval)return null;
  return jsonHash({id:op.id,revision:op.revision,stage:op.stage,plan:op.plan.plan.digest,approvalDigest:op.approval.digest,image:op.image,source:op.sourceGenerationId,target:op.targetGenerationId,verification:op.receipts.verify?.digest??null});
}
export function migrationActions(op:DatabaseMigrationOperation):DatabaseMigrationDto['actions']{
  if(migrationEnded(op)||op.abandonRequested)return [];
  const actions:DatabaseMigrationDto['actions']=[];
  if(op.error){
    actions.push('retry');
    if(op.stage==='rolling-back'&&op.currentAttempt?.purpose==='database-migration-rollback'&&op.currentAttempt.proof?.receipt.state==='failed'&&!op.receipts.rollback&&op.rollbackRequest===null&&op.receipts.verify)actions.push('cancel-rollback');
  }
  else {
    if(['awaiting-approval','approved'].includes(op.stage))actions.push('replan');
    if(['awaiting-approval','awaiting-reapproval'].includes(op.stage)&&op.plan&&!op.plan.plan.payload.blocks.length)actions.push('approve');
    if(migrationConfirmation(op))actions.push(op.stage==='approved'?'switch':'open');
  }
  if(migrationBeforeFreeze(op))actions.push('abandon');
  if(migrationRollbackAllowed(op))actions.push('rollback');
  return actions;
}
export function migrationDto(op:DatabaseMigrationOperation):DatabaseMigrationDto {
  const {requestDigest:_request,sourceBindingRevision:_binding,targetSlot:_slot,manifest:_manifest,environmentBox:_env,environmentVersion:_version,currentAttempt,previousAttempts,prepared:_prepared,rollbackRequest:_rollback,freeze:_freeze,switchActor:_actor,maintenanceRevision:_maintenance,candidateProof:_proof,receipts:_receipts,abandonRequested:_abandon,...publicFields}=op;
  const attempts=[...previousAttempts,...(currentAttempt?[currentAttempt]:[])].map(a=>({jobId:a.jobId,purpose:a.purpose,receipt:a.proof?.receipt??null,logTail:a.proof?.logTail??'',receiptDigest:a.receiptDigest}));
  return DatabaseMigrationDtoSchema.parse({...publicFields,attempts,actions:migrationActions(op),blockedReason:op.error,confirmationDigest:migrationConfirmation(op)});
}
export const migrationJobPurpose = (stage:DatabaseMigrationOperation['stage']):DatabaseMigrationJobPurpose|null => ({planning:'database-migration-plan',migrating:'database-migration-run',verifying:'database-migration-verify','rolling-back':'database-migration-rollback',completing:'database-migration-complete'} as const)[stage as 'planning']??null;
export const migrationPlanView = (operationId:string,plan:DatabaseMigrationPlanView['plan']):DatabaseMigrationPlanView => ({operationId,plan,jsonPath:null,markdownPath:null,acknowledgeable:[],requiresApproval:true,guidance:[]});
