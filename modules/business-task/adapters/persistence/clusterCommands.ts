import { eq, sql } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import type { ClusterCommands } from '../../ports/clusterCommands';
import { clusterCommands } from './tables';
export function drizzleClusterCommands(db: Database): ClusterCommands {
  return { get: async (id) => (await db.select().from(clusterCommands).where(eq(clusterCommands.id, id)))[0]?.body,
    save: async (command) => { await db.insert(clusterCommands).values({ id: command.operation.operationId, body: command }).onConflictDoUpdate({ target: clusterCommands.id, set: { body: command } }); },
    withLock: (id, run) => db.transaction(async (tx) => { await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('business-task.cluster-command'), hashtext(${id}))`); return run(); }),
  };
}
