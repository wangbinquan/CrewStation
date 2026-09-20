import { ResourceIdSchema } from '@crewstation/contracts';
import type { TaskId } from '@crewstation/contracts';
import type { Clock } from '@crewstation/kernel';
import { newResourceId } from '@crewstation/kernel';
import type { Database, ResourceIdentityDirectory } from '@crewstation/persistence';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { ComparisonReference } from '../../domain/comparisonReference';
import type { ComparisonReferences } from '../../ports/comparisons';
import { comparisonReferences as refs } from './comparisonTables';
import { legacyComparisonReference } from './legacyComparisonReference';

export function drizzleComparisonReferences(db: Database, clock: Clock, identities?: ResourceIdentityDirectory): ComparisonReferences {
  const cutoff = () => new Date(clock.now().getTime() - 24 * 60 * 60 * 1000);
  const create = async (reference: Omit<ComparisonReference, 'id'>) => {
    await db.delete(refs).where(lt(refs.createdAt, cutoff()));
    const rows = await db.insert(refs).values({ ...reference, id: newResourceId(), createdAt: clock.now() }).onConflictDoUpdate({
      target: [refs.taskId, refs.runnerComparisonId, refs.target, refs.deployment], set: { createdAt: clock.now() },
    }).returning({ id: refs.id });
    return rows[0]!.id;
  };
  return { create, get: async (value) => {
    let id = value;
    if (!ResourceIdSchema.safeParse(value).success) {
      const reference = await legacyComparisonReference(value, identities);
      if (!reference) return undefined;
      id = await create(reference);
    }
    const row = (await db.select().from(refs).where(and(eq(refs.id, id), gt(refs.createdAt, cutoff()))))[0];
    return row ? { id: row.id, taskId: row.taskId as TaskId, runnerComparisonId: row.runnerComparisonId, target: row.target as ComparisonReference['target'], deployment: row.deployment } : undefined;
  } };
}
