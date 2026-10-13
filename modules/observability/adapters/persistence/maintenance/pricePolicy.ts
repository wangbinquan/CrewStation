import {sql} from 'drizzle-orm';
import type {Transaction} from '@crewstation/persistence';
import type {RuntimeMaintenance,UsageRecord} from '@crewstation/contracts';
import {jsonHash,conflict} from '@crewstation/kernel';
import {admitObservationWrite} from '../projectDeletion';
import type {AcceptedExecutionPrice} from '../../../ports/tokenPricing';
/** Audit replay is byte-equivalent; a previously confirmed operation cannot replace a later correction. */
export async function applyRuntimePricePolicy(tx:Transaction,d:RuntimeMaintenance,usage:UsageRecord,taskKey:string,original:AcceptedExecutionPrice){
 const i=usage.identity;await admitObservationWrite(tx,i.projectId);
 await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'observability.execution-price/'+i.executionId+'/'+i.executionGeneration},0))`);
 const [operation]=await tx.execute(sql`SELECT confirmed_order::text AS ordinal FROM observability.runtime_maintenance WHERE id=${d.id}`);if(!operation?.['ordinal'])throw conflict('维护操作尚未完成确认');
 const ordinal=String(operation['ordinal']),policy={identity:i,profileId:original.profile!.id,originalAccepted:original,targetPriceBookRevision:d.request.targetPriceBookRevision,operationId:d.id,operationOrder:ordinal,confirmedAt:d.confirmedAt,repriceAt:d.createdAt};
 const [previous]=await tx.execute(sql`SELECT document FROM observability.execution_price_corrections WHERE execution_id=${i.executionId} AND generation=${i.executionGeneration} FOR UPDATE`);
 if(previous&&BigInt(String((previous['document'] as {operationOrder:string}).operationOrder))>BigInt(ordinal))throw conflict('该执行已有较晚确认的价格纠错，原操作未覆盖它');
 await tx.execute(sql`INSERT INTO observability.execution_price_correction_audit VALUES(${d.id},${i.executionId},${i.executionGeneration},${i.projectId},${i.taskId},${taskKey},${JSON.stringify(policy)}::jsonb) ON CONFLICT DO NOTHING`);
 const [audit]=await tx.execute(sql`SELECT document FROM observability.execution_price_correction_audit WHERE operation_id=${d.id} AND execution_id=${i.executionId} AND generation=${i.executionGeneration}`);if(jsonHash(audit?.['document'])!==jsonHash(policy))throw conflict('原价格纠错审计重放内容冲突');
 await tx.execute(sql`INSERT INTO observability.execution_price_corrections(execution_id,generation,project_id,task_id,task_key,document) VALUES(${i.executionId},${i.executionGeneration},${i.projectId},${i.taskId},${taskKey},${JSON.stringify(policy)}::jsonb) ON CONFLICT(execution_id,generation) DO UPDATE SET revision=observability.execution_price_corrections.revision+CASE WHEN observability.execution_price_corrections.document->>'operationId'=excluded.document->>'operationId' THEN 0 ELSE 1 END,document=excluded.document`);
 await tx.execute(sql`INSERT INTO observability.execution_price_correction_records(project_id,task_id,task_key,execution_id,generation,source_id,record_id,operation_id,document) VALUES(${i.projectId},${i.taskId},${taskKey},${i.executionId},${i.executionGeneration},${usage.sourceId},${usage.recordId},${d.id},${JSON.stringify(policy)}::jsonb) ON CONFLICT(execution_id,generation,source_id,record_id) DO UPDATE SET operation_id=excluded.operation_id,document=excluded.document`);
}

 // This function is invoked for each frozen canonical meter, not newly arriving rows.
