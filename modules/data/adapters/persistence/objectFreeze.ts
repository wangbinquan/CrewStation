import { and, eq, sql } from 'drizzle-orm';
import { notFound } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import type { ObjectCatalogRepository } from '../../ports/objectStorage';
import { finalizationBindings, objectAttempts, objectSpaces, objectStorageFreezes, storedObjects } from './objectTables';

/** Called under the metadata lock. A freeze request is not an acknowledgement of quiescence. */
export async function objectFreezeStatus(tx: Executor, id: string): Promise<Awaited<ReturnType<ObjectCatalogRepository['freezeStatus']>>> {
  const freeze = (await tx.select().from(objectStorageFreezes).where(eq(objectStorageFreezes.id, id)))[0]?.body;
  if (!freeze) throw notFound('存储冻结');
  if (!freeze.active) return { phase: 'released', epoch: freeze.epoch, blockers: [] };
  const backendId = freeze.backendId, count = { n: sql<number>`count(*)::int` };
  const [writers] = await tx.select(count).from(objectAttempts).where(and(backendId ? eq(objectAttempts.backendId, backendId) : undefined,
    sql`${objectAttempts.state} IN ('streaming','unknown') AND ${objectAttempts.body}->>'writerEndedAt' IS NULL`));
  const [verification] = await tx.select(count).from(objectAttempts).where(and(backendId ? eq(objectAttempts.backendId, backendId) : undefined, eq(objectAttempts.state, 'verifying')));
  const [deletions] = await tx.select(count).from(storedObjects).where(and(backendId ? sql`${storedObjects.body}->>'backendId' = ${backendId}` : undefined,
    eq(storedObjects.state, 'deleting'), sql`coalesce((${storedObjects.body}->'deletion'->>'sequence')::int,0)>0`));
  const [garbage] = await tx.select(count).from(objectAttempts).where(and(backendId ? eq(objectAttempts.backendId, backendId) : undefined, eq(objectAttempts.state, 'deleting')));
  const [volumes] = await tx.select(count).from(finalizationBindings).innerJoin(objectSpaces, eq(finalizationBindings.spaceId, objectSpaces.id))
    .where(and(backendId ? eq(objectSpaces.backendId, backendId) : undefined, eq(finalizationBindings.state, 'delete-started')));
  const blockers: Awaited<ReturnType<ObjectCatalogRepository['freezeStatus']>>['blockers'] = [];
  for (const [kind, n] of [['writer', writers?.n], ['verification', verification?.n], ['object-deletion', (deletions?.n ?? 0) + (garbage?.n ?? 0)], ['volume-deletion', volumes?.n]] as const) if (n) blockers.push({ kind, count: n });
  return { phase: blockers.length ? 'draining' : 'frozen', epoch: freeze.epoch, blockers };
}
