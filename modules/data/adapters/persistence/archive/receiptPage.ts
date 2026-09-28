import { and, eq, sql } from 'drizzle-orm';
import type { ArchiveArtifactDeletion, ArchiveReceiptDto, ArchiveReceiptItem } from '@crewstation/contracts';
import { ArchiveReceiptPageQuerySchema, ArchiveReceiptPageSchema, OBJECT_STORAGE_LIMITS } from '@crewstation/contracts';
import type { Database } from '@crewstation/persistence';
import { precondition } from '@crewstation/kernel';
import type { ObjectReadRepository } from '../../../ports/objectStorage';
import { finalizationBindings } from '../objectTables';

/** Read a bounded projection from the immutable receipt; no task, transfer or cleanup mutation. */
export function archiveReceiptPage(db: Database): ObjectReadRepository['receiptPage'] {
  return async (id, offset, limit) => {
    ArchiveReceiptPageQuerySchema.parse({ offset, limit });
    const body = finalizationBindings.body;
    const row = (await db.select({ spaceId: finalizationBindings.spaceId, receipt: sql<ArchiveReceiptDto>`${body}->'receipt'`,
      artifactsDeleted: sql<ArchiveArtifactDeletion | null>`${body}->'artifactsDeletion'->'result'`,
      items: sql<ArchiveReceiptItem[]>`(SELECT coalesce(jsonb_agg(items.item ORDER BY items.n), '[]'::jsonb) FROM (SELECT item,n FROM jsonb_array_elements(${body}->'items') WITH ORDINALITY AS entries(item,n) WHERE n > ${offset} ORDER BY n LIMIT ${limit}) items)`,
    }).from(finalizationBindings).where(and(eq(finalizationBindings.id, id), sql`${body}->'receipt'->>'id' IS NOT NULL`)))[0];
    if (!row) return undefined;
    let bytes = Buffer.byteLength(JSON.stringify({ receipt: row.receipt, artifactsDeleted: row.artifactsDeleted, items: [], nextOffset: 10000 })), count = 0;
    for (const item of row.items) {
      const size = Buffer.byteLength(JSON.stringify(item)) + 1;
      if (bytes + size > OBJECT_STORAGE_LIMITS.pageBytes) break;
      bytes += size; count++;
    }
    if (row.items.length && count === 0) throw precondition('归档收据条目超过分页大小上限', { code: 'archive_receipt_item_too_large' });
    const items = row.items.slice(0, count), nextOffset = offset + count < row.receipt.itemCount ? offset + count : null;
    return { spaceId: row.spaceId, ...ArchiveReceiptPageSchema.parse({ receipt: row.receipt, items, nextOffset, artifactsDeleted: row.artifactsDeleted }) };
  };
}
