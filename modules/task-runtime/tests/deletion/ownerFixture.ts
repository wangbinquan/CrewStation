import { PROJECT_DELETION_PHASES, ProjectDeletionContextSchema } from '@crewstation/contracts';
import type { ProjectDeletionPhase, ProjectDeletionStepResult } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';
import { runtimeDeletionOwner } from '../../application/deletion/owner';
import { runtimeDeletionRepository } from '../../adapters/persistence/deletion/repository';
import { runtimeProjectWork } from '../../adapters/persistence/deletion/projectWork';
import type { RuntimeWorkSources } from '../../ports/deletion/work';
import { runtimeWorkFixture } from './workFixture';
import { seedRuntimeContent } from './contentFixture';

/** Actual SQL owner and callbacks; public phase grants and stopping are controlled, not physical/model acceptance. */
export async function runtimeOwnerFixture(seed = true) {
  const f = await runtimeWorkFixture(), seeded = seed ? await seedRuntimeContent(f) : undefined;
  let phase: ProjectDeletionPhase = 'seal', generation = 1, ready = true, calls = 0;
  const sources: RuntimeWorkSources = { ...f.sources, assertGrant: async (context) => {
    await f.sources.assertGrant(context);
    if (context.phase !== phase || context.generation !== generation) throw precondition('controlled current original phase or generation unavailable');
  } };
  const work = runtimeProjectWork(f.database.db, sources), repository = runtimeDeletionRepository(f.database.db, sources);
  await work.run(f.input(), async () => undefined);
  const confirmed = (await repository.inspect(f.target)).inventory, original = await f.context();
  const context = (next: ProjectDeletionPhase = phase, nextGeneration = generation) => ProjectDeletionContextSchema.parse({
    ...original, generation: nextGeneration, phase: next, confirmed,
  });
  const rootInput = { originKind: 'project' as const, originKey: f.project, reference: original.operationId, inputDigest: jsonHash('controlled-original-stop') };
  const owner = runtimeDeletionOwner(repository, sources, { stop: async (grant) => {
    calls++;
    if (!ready) return { kind: 'waiting', reason: 'controlled original stopping is incomplete' };
    await work.runGranted(grant, rootInput, () => f.database.db.transaction((tx) => tx.execute(sql`
      UPDATE task_runtime.environments SET message='controlled-original-stop' WHERE id=${f.parent}`)));
    return { kind: 'done', evidence: { kind: 'metadata', count: 1, digest: jsonHash('controlled-stop'), description: 'controlled stop; not physical evidence' } };
  } });
  const grant = (next: ProjectDeletionPhase, nextGeneration = generation) => { phase = next; generation = nextGeneration; };
  const run = (next: ProjectDeletionPhase, nextGeneration = generation) => { grant(next, nextGeneration); return owner.run(context()); };
  const through = async (end: ProjectDeletionPhase) => {
    const results: ProjectDeletionStepResult[] = [];
    for (const next of PROJECT_DELETION_PHASES.slice(0, PROJECT_DELETION_PHASES.indexOf(end) + 1)) results.push(await run(next));
    return results;
  };
  return { ...f, work, repository, owner, sources, seeded, confirmed, context, rootInput, grant, run, through,
    stopReady: (value: boolean) => { ready = value; }, stopCalls: () => calls,
    drop: async () => { await work.drain(); await f.drop(); } };
}
