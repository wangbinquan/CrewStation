import type { ProjectDeletionOperation } from '@crewstation/contracts';
import { readEventContents, removeEventContentsInTransaction } from '@crewstation/eventbus';
import type { EventContentItem } from '@crewstation/eventbus';
import { precondition } from '@crewstation/kernel';
import type { Transaction } from '@crewstation/persistence';
import { readQueueContents, removeQueueContents } from '@crewstation/queue';
import type { QueueContentItem } from '@crewstation/queue';
import type { InfrastructureOriginDocument } from '../../domain/infrastructureOrigins';
import { isInfrastructureCoordinator } from '../../domain/infrastructureCoordinator';

/** Called by project inside the same transaction that holds the original operation lock and removes the project root. */
export async function removeDeletionCoordinator(executor: object, operation: ProjectDeletionOperation): Promise<void> {
  const tx = executor as Transaction, coordinator = { operationId: operation.id, projectId: operation.project.id };
  for (const channel of ['queue', 'event'] as const) {
    // A failed CAS keeps the original row locks; the second complete read sees the finished heartbeat/dead-letter write.
    let stable = false;
    for (let attempt = 0; attempt < 2 && !stable; attempt++) {
      let after: string | null = null; stable = true;
      for (;;) {
        const rows: readonly (QueueContentItem | EventContentItem)[] = channel === 'queue' ? await readQueueContents(tx, after) : await readEventContents(tx, after);
        if (!rows.length) break;
        const originals = rows.filter((row) => {
          const document: InfrastructureOriginDocument = { channel, name: 'kind' in row ? row.kind : row.topic,
            payload: row.payload, legacyPayload: row.legacyPayload, identityProvenance: row.identityProvenance };
          return isInfrastructureCoordinator(document, coordinator);
        });
        const result = channel === 'queue' ? await removeQueueContents(tx, originals) : await removeEventContentsInTransaction(tx, originals);
        if (!result.stable) { stable = false; break; }
        after = rows.at(-1)!.id;
      }
    }
    if (!stable) throw precondition('删除协调内容仍在变化，原操作和项目根保留供重试');
  }
}
