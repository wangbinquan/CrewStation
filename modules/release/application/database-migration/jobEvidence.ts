import { DatabaseMigrationApprovalRequestSchema, DatabaseMigrationPlanSchema, DatabaseMigrationPlanViewSchema, DatabaseMigrationReceiptSchema } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';
import type { DatabaseMigrationOperation, MigrationJobProof } from '../../domain/database-migration/operation';
import { migrationOperationKey, migrationPlanView } from '../../domain/database-migration/operation';
import { migrationCanonical, migrationDigest } from '../../domain/database-migration/evidence';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { migrationContext } from './context';
const artifacts={run:'activation-receipt.json',verify:'switch-receipt.json',rollback:'rollback-receipt.json',complete:'completion-receipt.json'} as const;
const mismatch=()=>conflict('Job 输出与迁移产物或准备回执不一致',{code:'database_migration_receipt_mismatch'});
export async function migrationJobEvidence(deps:ReleaseUseCaseDeps,op:DatabaseMigrationOperation,proof:MigrationJobProof):Promise<Partial<DatabaseMigrationOperation>>{
 const c=migrationContext(deps),output=proof.output;if(!output)throw mismatch();
 const action=op.currentAttempt!.purpose.slice('database-migration-'.length) as 'plan'|keyof typeof artifacts;
 if(output.kind==='plan'){
  if(action!=='plan'&&action!=='run')throw mismatch();
  const raw:unknown=JSON.parse(output.text),full=DatabaseMigrationPlanViewSchema.safeParse(raw),request=full.success?null:DatabaseMigrationApprovalRequestSchema.parse(raw);
  const planDigest=full.success?full.data.plan.digest:request!.planDigest;
  const artifact=await c.store.artifact(op.id,`plans/${planDigest}.json`);if(!artifact)throw mismatch();
  const text=Buffer.from(artifact.bytes,'base64').toString(),plan=DatabaseMigrationPlanSchema.parse(JSON.parse(text));
  if(migrationCanonical(plan)!==text||migrationDigest(plan.payload)!==plan.digest||plan.digest!==planDigest||plan.approvalDigest!==(full.success?full.data.plan.approvalDigest:request!.approvalDigest)||plan.payload['operationId']!==migrationOperationKey(op.id))throw mismatch();
  if((full.success?full.data.operationId:request!.operationId)!==migrationOperationKey(op.id)||full.success&&migrationCanonical(full.data.plan)!==text)throw mismatch();
  return {plan:full.success?{...full.data,plan}:migrationPlanView(migrationOperationKey(op.id),plan),approval:null,stage:action==='run'?'awaiting-reapproval':'awaiting-approval'};
 }
 if(action==='plan')throw mismatch();
 const artifact=await c.store.artifact(op.id,artifacts[action]);
 if(!artifact||Buffer.from(artifact.bytes,'base64').toString()!==output.text)throw mismatch();
 const receipt=DatabaseMigrationReceiptSchema.parse(JSON.parse(output.text)),p=receipt.payload;
 if(migrationDigest(p)!==receipt.digest||p.operationId!==migrationOperationKey(op.id))throw mismatch();
 if(action==='run'){
  const target=p['target'] as {generationId?:string;location?:unknown}|undefined;
  if(!op.prepared||receipt.digest!==op.prepared.receiptDigest||target?.generationId!==op.prepared.generationId||migrationCanonical(target?.location)!==migrationCanonical(op.prepared.location)||p['approvalDigest']!==op.approval?.digest||target?.generationId!==op.plan?.plan.payload.target.generationId)throw mismatch();
 }else if(action==='verify'||action==='complete'){
  if(p['kind']!==(action==='verify'?'verified':'completed')||p['generationId']!==op.prepared?.generationId||p['activationReceiptDigest']!==op.receipts.run?.digest)throw mismatch();
 }else if(p['kind']!=='rolled-back'||p['firstLiveWriteAt']!==null||op.prepared&&p['generationId']!==op.prepared.generationId)throw mismatch();
 return {receipts:{...op.receipts,[action]:receipt},currentAttempt:{...op.currentAttempt!,proof,receiptDigest:receipt.digest},...(action==='run'?{stage:'activating'}:action==='verify'?{stage:'ready-to-open'}:{})};
}
