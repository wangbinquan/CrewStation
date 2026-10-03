import { readEventContents, readOrphanEventDeadLetters } from '@crewstation/eventbus';
import type { Database } from '@crewstation/persistence';
import { readQueueContents } from '@crewstation/queue';
import { sql } from 'drizzle-orm';
import type { InfrastructureContentSource } from '../../ports/infrastructureContents';

/** Packages own the shared tables; this module receives their public, shape-checked content readers. */
export function infrastructureContentSource(db: Database): InfrastructureContentSource {
  return {
    withSnapshot: (read) => db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
      return read({
        queue: async (after) => (await readQueueContents(tx, after)).map((row) => ({
          id: row.id, birthDigest: row.birthDigest, contentDigest: row.contentDigest, deadLetters: 0,
          document: { channel: 'queue', name: row.kind, payload: row.payload, legacyPayload: row.legacyPayload, identityProvenance: row.identityProvenance },
        })),
        event: async (after) => (await readEventContents(tx, after)).map((row) => ({
          id: row.id, birthDigest: row.birthDigest, contentDigest: row.contentDigest, deadLetters: row.deadLetters,
          document: { channel: 'event', name: row.topic, payload: row.payload, legacyPayload: row.legacyPayload, identityProvenance: row.identityProvenance },
        })),
        orphanErrors: async (after) => (await readOrphanEventDeadLetters(tx, after)).map((row) => ({ eventId: row.event_id, consumer: row.consumer, digest: row.digest })),
      });
    }),
  };
}
