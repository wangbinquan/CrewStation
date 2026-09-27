import { afterEach, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { migrationWriteBarrier } from '../application/execution/migrationBarrier';
import { executionHandoffFixture } from './executionHandoffFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 release migration launch gate', () => {
  let f: Awaited<ReturnType<typeof executionHandoffFixture>>;
  afterEach(async () => { await f?.close(); });
  test('closed entries alone do not authorize migration; both durable application barrier and observed Pod absence are necessary', async () => {
    f = await executionHandoffFixture();
    const manifest = f.target.manifest!; if (manifest.kind !== 'DigitalWorker') throw new Error('fixture');
    const target = { ...f.target, manifest: { ...manifest, spec: { ...manifest.spec, release: { migrationCommand: ['migrate'], migration: { compatibility: 'destructive' as const, destructive: true, rollback: 'blocked' as const } } } } };
    await expect(migrationWriteBarrier(f.deps, target)).rejects.toMatchObject({ kind: 'precondition' });
    const state = { ready: false, absent: false, calls: 0 };
    f.deps.executionHandoff.migrationBarrier = async (_id, request) => { state.calls++; expect(request.operationId).toBe(target.id); expect(request.expectedActiveReleaseId).toBe(f.old.id); return { ready: state.ready, epoch: 2, blocked: state.ready ? [] : ['application_write_barrier_missing'] }; };
    f.deps.executionHandoff.observeWritersStopped = async () => state.absent;
    expect(await migrationWriteBarrier(f.deps, target)).toMatchObject({ ready: false, message: expect.stringContaining('application_write_barrier_missing') });
    state.ready = true;
    expect(await migrationWriteBarrier(f.deps, target)).toMatchObject({ ready: false, message: expect.stringContaining('Pod') });
    state.absent = true; expect(await migrationWriteBarrier(f.deps, target)).toEqual({ ready: true });
    f.state.window = false;
    await expect(migrationWriteBarrier(f.deps, target)).rejects.toMatchObject({ kind: 'precondition' });
    expect(state.calls).toBe(3);
    expect(await migrationWriteBarrier(f.deps, f.target)).toEqual({ ready: true });
  });
});
