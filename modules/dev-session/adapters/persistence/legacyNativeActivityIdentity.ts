import { ResourceIdSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';

/** Old Runner event numbers are local to an execution; retain one durable UUID per source. */
export async function nativeActivityIdentity(db: Executor, sourceTaskId: string, eventId: string): Promise<string> {
  if (ResourceIdSchema.safeParse(eventId).success) return eventId;
  const key = JSON.stringify([sourceTaskId, eventId]);
  const rows = await db.execute(sql`INSERT INTO dev_session.resource_identity_aliases (kind, key, id)
    VALUES ('native-activity-event', ${key}, ${newResourceId()})
    ON CONFLICT (kind, key) DO UPDATE SET key = EXCLUDED.key RETURNING id`) as unknown as { id: string }[];
  return rows[0]!.id;
}
