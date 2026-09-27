import { and, eq, sql } from 'drizzle-orm';
import { conflict, validation } from '@crewstation/kernel';
import type { ExecutionOperation, OperationKey, OperationLease } from '../../domain/taskAdmission';
import { executionOperations as ops } from './executionTables';

export function toOperation(row: typeof ops.$inferSelect): ExecutionOperation {
  return {
    id: row.id, serviceId: row.serviceId, kind: row.kind as ExecutionOperation['kind'], parentId: row.parentId, requestKey: row.requestKey,
    requestDigest: row.requestDigest, effectiveDigest: row.effectiveDigest, intent: row.intent, epoch: row.epoch,
    state: row.state as ExecutionOperation['state'], revision: row.revision, attempts: row.attempts, errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    lease: row.leaseOwner && row.leaseUntil ? { owner: row.leaseOwner, until: row.leaseUntil.toISOString() } : null,
  };
}
export const operationKeyed = (key: OperationKey) => and(eq(ops.serviceId, key.serviceId), eq(ops.kind, key.kind), eq(ops.parentId, key.parentId), eq(ops.requestKey, key.requestKey));
export const operationLeased = (lease: OperationLease) => and(eq(ops.id, lease.id), eq(ops.leaseOwner, lease.owner), eq(ops.revision, lease.revision), eq(ops.state, 'running'), sql`${ops.leaseUntil} > clock_timestamp()`);
export function leaseSeconds(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 300) throw validation('操作租约应为 1～300 秒');
  return value;
}
export function verifyOperationDigest(operation: ExecutionOperation, digest: string): void {
  if (operation.requestDigest !== digest) throw conflict('同一 requestKey 已用于不同请求', { code: 'idempotency_conflict' });
}
