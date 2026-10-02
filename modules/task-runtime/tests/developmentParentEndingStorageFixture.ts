import { expect } from 'bun:test';
import { ResourceIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';
import { snapshotDevelopmentParentEpoch, developmentParentEpochHash } from '../domain/development/parentEnding';
import type { DevelopmentParentEndingIdentity, DevelopmentParentEnding, DevelopmentParentRebuildClaim } from '../ports/developmentParentEnding';
import { drizzleDevelopmentParentEndings, drizzleDevelopmentParentRebuildClaims } from '../adapters/persistence/developmentParentEndings';
import { drizzleDevelopmentParentEndingChildren, drizzleDevelopmentParentEndingObjects } from '../adapters/persistence/developmentParentEndingChildren';
import { drizzleAdmissionRepository } from '../adapters/persistence/drizzleRepositories';
import { developmentWorkloadFixture } from './developmentWorkloadFixture';

export async function developmentParentEndingStorageFixture() {
  const f = await developmentWorkloadFixture('ledger'), db = f.tdb.db;
  const epoch = snapshotDevelopmentParentEpoch(f.parent, { podUid: f.parentPod.metadata.uid!, pvcUid: f.pvc.metadata.uid! });
  const endings = drizzleDevelopmentParentEndings(db), children = drizzleDevelopmentParentEndingChildren(db);
  const objects = drizzleDevelopmentParentEndingObjects(db), claims = drizzleDevelopmentParentRebuildClaims(db);
  const identity = (parentId = f.parent.id): DevelopmentParentEndingIdentity => {
    const original = { ...epoch, parentId };
    return { id: ResourceIdSchema.parse(Bun.randomUUIDv7()), parentId, projectId: f.projectId, operation: 'release', epoch: original,
      epochHash: developmentParentEpochHash(original), selectionHash: jsonHash({ original, protection: { version: 1 } }), intent: { operation: 'release' } };
  };
  const admit = (selected = identity()) => db.transaction(async (tx) => {
    await drizzleAdmissionRepository(tx).lock(selected.projectId);
    return drizzleDevelopmentParentEndings(tx).admit(selected, new Date());
  });
  const move = async (id: string, phase: DevelopmentParentEnding['phase']) => {
    const old = (await endings.get(id))!;
    return endings.progress(id, old.phase, { phase, status: phase === 'complete' ? 'complete' : 'pending', afterChildId: null,
      progress: { storageOnly: true }, completionWitness: phase === 'complete' ? { storageOnly: true, epochHash: old.epochHash } : null,
      message: null, retryAt: new Date() }, new Date());
  };
  const claim = (sourceEndingId: string): DevelopmentParentRebuildClaim => ({ sourceEndingId, currentRebuildId: Bun.randomUUIDv7(), revision: 1,
    afterTransitionHash: jsonHash({ sourceEndingId }), state: 'pending', retryAt: new Date(0) });
  const seed = async (count: number) => {
    const request = f.request(); await f.runtime.api.createNativeExecution(request);
    const ids = [request.id, ...Array.from({ length: count - 1 }, () => TaskIdSchema.parse(Bun.randomUUIDv7()))];
    const columns = await db.execute<{ column_name: string }>(sql`SELECT column_name FROM information_schema.columns
      WHERE table_schema='task_runtime' AND table_name='environments' AND is_generated='NEVER' ORDER BY ordinal_position`);
    const names = sql.join(columns.map((c) => sql.identifier(c.column_name)), sql`, `);
    const values = sql.join(columns.map((c) => sql`copy.${sql.identifier(c.column_name)}`), sql`, `);
    await db.execute(sql`INSERT INTO task_runtime.environments (${names}) SELECT ${values} FROM task_runtime.environments original
      CROSS JOIN jsonb_array_elements(${JSON.stringify(ids.slice(1))}::jsonb) item
      CROSS JOIN LATERAL jsonb_populate_record(NULL::task_runtime.environments, to_jsonb(original)||jsonb_build_object(
        'id',item#>>'{}','pod_name','original-child-'||(item#>>'{}'))) copy WHERE original.id=${request.id}`);
    return ids.sort();
  };
  return { ...f, db, epoch, identity, admit, move, claim, seed, endings, children, objects, claims };
}
export type DevelopmentParentEndingStorageFixture = Awaited<ReturnType<typeof developmentParentEndingStorageFixture>>;

/** Drizzle raw SQL is a thenable and wraps PostgreSQL errors; assert the actual database reason. */
export async function expectParentStorageRejection(operation: PromiseLike<unknown>, expected: string): Promise<void> {
  const error: unknown = await Promise.resolve(operation).then(() => undefined, (failure: unknown) => failure);
  expect(error).toBeInstanceOf(Error);
  const messages: string[] = [];
  let current = error;
  for (let depth = 0; current instanceof Error && depth < 10; depth++) {
    messages.push(current.message); current = current.cause;
  }
  expect(messages.join('\n')).toContain(expected);
}
