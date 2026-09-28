import { eq, sql } from 'drizzle-orm';
import type { ArchivePlanEntry } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import type { ArchivePlanRecord } from '../../../domain/objectStorage';
import { archivePlans } from '../objectTables';

/** Keep the hot file path bounded: do not transfer/decode the whole sealed manifest per operation. */
export async function archivePlanFile(tx: Executor, id: string, path: string) {
  const body = archivePlans.body;
  return (await tx.select({
    revision: sql<number>`(${body}->>'revision')::integer`,
    digest: sql<string | null>`${body}->>'digest'`,
    state: sql<ArchivePlanRecord['state']>`${body}->>'state'`,
    entry: sql<Extract<ArchivePlanEntry, { kind: 'file' }> | null>`(SELECT entry FROM jsonb_array_elements(${body}->'entries') entry WHERE entry->>'kind' = 'file' AND entry->>'path' = ${path} LIMIT 1)`,
    objectBytes: sql<number>`((${body}->>'byteCount')::bigint - (SELECT coalesce(sum(coalesce((entry->>'expectedSize')::bigint, 0)), 0) FROM jsonb_array_elements(${body}->'entries') entry WHERE entry->>'kind' = 'file'))::float8`,
  }).from(archivePlans).where(eq(archivePlans.id, id)))[0];
}
