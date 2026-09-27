import { requestMigrationStop } from '../application/execution/migrationStopRequest';
import { afterEach, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { migrationRecovery } from '../application/execution/migrationRecovery';
import { executionHandoffFixture } from './executionHandoffFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 failed migration recovery proof', () => {
  let f: Awaited<ReturnType<typeof executionHandoffFixture>>;
  afterEach(async () => { await f?.close(); });
  test('only a newer repair of a failed release with persisted Job completion and no remaining Pods may supersede', async () => {
    f = await executionHandoffFixture();
    f.state.authority.migration = { operationId: f.old.id, targetReleaseId: f.old.id, expectedActiveReleaseId: f.old.id };
    expect((await migrationRecovery(f.deps, f.target)).ready).toBe(false);
    await f.uow.read.releases.update({ ...f.old, status: 'failed' });
    const conditions: Array<{ type: string; status: 'true' | 'false'; reason?: string }> = [];
    const ledger = { jobRecord: async () => ({ id: 'migration', phase: 'failed', spec: { children: [] }, conditions }) };
    const deps = { ...f.deps, uow: { ...f.uow, read: { ...f.uow.read, ledger: { ...f.uow.read.ledger!, ...ledger } } } };
    expect(await migrationRecovery(deps, f.target)).toMatchObject({ ready: false, message: expect.stringContaining('持久终止证明') });
    conditions.push({ type: 'Failed', status: 'true' }, { type: 'Created', status: 'false' });
    expect((await migrationRecovery(deps, f.target)).ready).toBe(false);
    conditions.push({ type: 'Finished', status: 'true', reason: 'failed' });
    expect((await migrationRecovery(deps, f.target)).ready).toBe(false);
    f.deps.executionHandoff.observeMigrationStopped = async () => false;
    expect(await migrationRecovery(deps, f.target)).toMatchObject({ ready: false, message: expect.stringContaining('Pod') });
    f.deps.executionHandoff.observeMigrationStopped = async () => true;
    expect(await migrationRecovery(deps, f.target)).toEqual({ ready: true, supersedesOperationId: f.old.id });
    expect((await migrationRecovery(deps, { ...f.target, createdAt: f.old.createdAt })).ready).toBe(false);
    expect(await migrationRecovery(deps, f.old)).toEqual({ ready: true });
    conditions.pop(); conditions.push({ type: 'Stopped', status: 'true' });
    let required = false;
    f.deps.executionHandoff.observeMigrationStopped = async (_service, _release, fence) => { required = !!fence; return true; };
    expect((await migrationRecovery(deps, f.target)).ready).toBe(true); expect(required).toBe(true);
  });
  test('failure before Job declaration recreates only a failed stop intent, never treats missing record as proof', async () => {
    f = await executionHandoffFixture();
    if (f.old.manifest?.kind !== 'DigitalWorker') throw new Error('fixture manifest');
    const prior = { ...f.old, status: 'failed' as const, image: 'app:fixed', manifest: { ...f.old.manifest!, spec: { ...f.old.manifest!.spec, release: { ...f.old.manifest!.spec.release, migrationCommand: ['bun', 'migrate'] } } } };
    await f.uow.read.releases.update(prior);
    const calls: string[] = [];
    const uow = { ...f.uow, run: ((fn) => f.uow.run((scope) => fn({ ...scope, ledger: { ...scope.ledger!, jobRecord: async () => undefined,
      job: async (input) => { expect(input.job?.image).toBe('app:fixed'); expect(input.jobName).toContain(prior.id.replaceAll('-', '')); calls.push('declare'); },
      failJob: async (id) => { expect(id).toBe(prior.id); calls.push('failed'); },
    } }))) as typeof f.uow.run };
    await requestMigrationStop({ ...f.deps, uow }, prior);
    expect(calls).toEqual(['declare', 'failed']);
  });

});
