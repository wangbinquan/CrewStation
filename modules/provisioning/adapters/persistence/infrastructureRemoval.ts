import { removeEventContentsInTransaction } from '@crewstation/eventbus';
import type { Database } from '@crewstation/persistence';
import { removeQueueContents } from '@crewstation/queue';
import type { InfrastructureContentRemoval } from '../../ports/projectDeletion';

class ChangedContent extends Error {}
export function infrastructureContentRemoval(db: Database): InfrastructureContentRemoval {
  return { remove: async (contents) => {
    try {
      await db.transaction(async (tx) => {
        for (const channel of ['queue', 'event'] as const) {
          const rows = contents.filter((row) => row.channel === channel);
          for (let offset = 0; offset < rows.length; offset += 200) {
            const selected = rows.slice(offset, offset + 200);
            const result = channel === 'queue' ? await removeQueueContents(tx, selected) : await removeEventContentsInTransaction(tx, selected);
            if (!result.stable) throw new ChangedContent();
          }
        }
      }); return true;
    } catch (error) { if (error instanceof ChangedContent) return false; throw error; }
  } };
}
