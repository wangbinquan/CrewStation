import { jsonHash } from '@crewstation/kernel';
import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const SESSION_DELETION_TABLES = ['runner_events', 'connections', 'business_execution_events', 'business_usage_events', 'business_usage_sources',
  'business_stopped_executions', 'execution_completion_proofs', 'business_executions', 'development_usage_events', 'development_usage_streams',
  'connection_births', 'original_callbacks'] as const;
export const SessionStopSnapshotSchema = z.strictObject({ tables: z.array(z.strictObject({ table: z.enum(SESSION_DELETION_TABLES),
  count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), digest: hash })),
  count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), digest: hash }).superRefine((snapshot, context) => {
  if (jsonHash(snapshot.tables.map((table) => table.table)) !== jsonHash(SESSION_DELETION_TABLES)
    || snapshot.count !== snapshot.tables.reduce((total, table) => total + table.count, 0) || snapshot.digest !== jsonHash(snapshot.tables))
    context.addIssue({ code: 'custom', message: 'Session 停止后完整表集合、数量或摘要不符' });
});
