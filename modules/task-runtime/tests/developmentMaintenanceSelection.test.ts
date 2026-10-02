// RFC-034: the legacy check uses a complete SQL existential query, never the first 25 children.
import { afterEach, describe, expect, test } from 'bun:test';
import { jsonHash } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { developmentWorkloadFixture } from './developmentWorkloadFixture';
import type { DevelopmentWorkloadFixture } from './developmentWorkloadFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('complete maintenance legacy selection check (real PG)', () => {
  let f: DevelopmentWorkloadFixture;
  afterEach(async () => { await f?.close(); });
  test('the 27th malformed explicit selection blocks a parent behind 26 genuine legacy children', async () => {
    f = await developmentWorkloadFixture('ledger');
    const record = (await f.resources.api.get(f.parent.id))!;
    const snapshot = { id: record.id, projectId: record.projectId ?? null, owner: record.owner, kind: record.kind,
      generation: record.generation, version: record.version, retainUntil: record.retainUntil?.toISOString() ?? null,
      phaseSince: record.phaseSince.toISOString(), specHash: jsonHash(record.spec) };
    const hasSelected = f.uow.read.environments.hasProtectedDevelopmentChildren!;
    expect(await hasSelected(f.parent.id)).toBe(false);
    expect(await f.runtime.api.inspectResourceEnding!('compaction', snapshot)).toEqual({ status: 'unselected' });
    const { developmentUsageProtection: _usage, developmentUsageStorage: _storage, ...legacyInput } = f.request();
    await f.runtime.api.createNativeExecution(legacyInput);
    const ids = Array.from({ length: 26 }, () => ({ id: Bun.randomUUIDv7(), agent: Bun.randomUUIDv7(), runner: crypto.randomUUID() }));
    await f.tdb.db.execute(sql`INSERT INTO task_runtime.environments SELECT (jsonb_populate_record(NULL::task_runtime.environments,
      to_jsonb(e)||jsonb_build_object('id',item->>'id','pod_name','legacy-clone-'||(item->>'id'),
        'native',e.native||jsonb_build_object('agentId',item->>'agent','runnerId',item->>'runner')))).*
      FROM task_runtime.environments e CROSS JOIN jsonb_array_elements(${JSON.stringify(ids)}::jsonb) item WHERE e.id=${legacyInput.id}`);
    expect(await hasSelected(f.parent.id)).toBe(false);
    const [count] = await f.tdb.db.execute(sql`SELECT count(*)::int AS n FROM task_runtime.environments WHERE native->>'parentTaskId'=${f.parent.id}`);
    expect(count!.n).toBe(27);
    await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET render=jsonb_set(render,'{developmentUsageProtection}','false'::jsonb,true) WHERE id=${ids[25]!.id}`);
    expect(await hasSelected(f.parent.id)).toBe(true);
    expect(await f.runtime.api.inspectResourceEnding!('compaction', snapshot)).toMatchObject({ status: 'waiting' });
  });
});
