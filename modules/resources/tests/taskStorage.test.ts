import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { ResourceDeclaration } from '../api/types';
import { drizzleLedgerUnitOfWork } from '../adapters/persistence/drizzleLedger';
import { expireRetention } from '../application/maintenance';
import type { Harness } from './fixtures';
import { ADMIN, createHarness, OTHER_PROJECT, PROJECT, workspace } from './fixtures';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-035 task work volume protection', () => {
  let h: Harness;
  afterEach(async () => { await h?.database.drop(); });
  async function fixture() {
    h = await createHarness();
    const owner = h.module.api.owner('task-runtime'), id = newResourceId();
    await owner.declare(workspace(id, { id, kind: 'business-workspace', purpose: 'business-workspace' }));
    const declaration: ResourceDeclaration = { kind: 'volume', projectId: PROJECT, ref: `${id}/work`, parentId: id,
      spec: { children: [{ kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: `${id}-work` }], reclaim: 'retain', taskStorage: { taskId: id, completionPolicy: 'archive-and-delete' } } };
    return { owner, id, declaration };
  }
  test('owner release and administrator delete cannot bypass finalization; Pod release retains the volume', async () => {
    const { owner, id, declaration } = await fixture(), volume = await owner.declare(declaration);
    await owner.requestRelease(id, { code: 'released', message: 'Pod ended' });
    await expect(owner.requestRelease(volume.id, { code: 'released', message: 'Pod ended' })).rejects.toMatchObject({ details: { code: 'finalization_required' } });
    await h.module.api.observeConditions(volume.id, [{ type: 'PendingReclaim', status: 'true', reason: 'orphaned' }]);
    await expect(h.module.api.performAction(ADMIN, volume.id, 'delete-volume', {})).rejects.toMatchObject({ kind: 'precondition', details: { code: 'action-disabled' } });
    expect((await h.module.api.view(ADMIN, PROJECT, { kind: 'volume', includeStopped: 'true' })).items[0]?.actions[0]).toMatchObject({ id: 'delete-volume', enabled: false });
    expect(await h.module.api.get(volume.id)).toMatchObject({ desired: 'present', spec: declaration.spec });
  });
  test('volume ownership, protected policy and original physical target cannot be silently replaced', async () => {
    const { owner, declaration } = await fixture(), volume = await owner.declare(declaration);
    expect((await owner.declare(declaration)).id).toBe(volume.id);
    const { taskStorage: _policy, ...legacy } = declaration.spec;
    for (const candidate of [
      { ...declaration, spec: legacy }, { ...declaration, projectId: OTHER_PROJECT },
      { ...declaration, spec: { ...declaration.spec, reclaim: 'delete' } },
      { ...declaration, spec: { ...declaration.spec, children: [{ kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'replacement' }] } },
    ]) await expect(owner.declare(candidate)).rejects.toMatchObject({ kind: 'conflict' });
    await expect(h.module.api.owner('release').declare({ ...declaration, ref: 'foreign' })).rejects.toMatchObject({ kind: 'forbidden' });
    const old = await owner.declare({ ...declaration, ref: 'legacy', spec: { ...legacy, children: [] } });
    await expect(owner.declare({ ...declaration, id: old.id })).rejects.toMatchObject({ kind: 'conflict' });
    expect(await h.module.api.get(volume.id)).toMatchObject({ desired: 'present', spec: declaration.spec });
  });
  test('protected volumes cannot expire and do not starve the legacy retention queue', async () => {
    const { owner, declaration } = await fixture(), protectedVolume = await owner.declare(declaration);
    const legacy = await owner.declare({ kind: 'volume', ref: 'legacy-retention', projectId: PROJECT, spec: { children: [] } });
    // Exercise the persisted retention query even if a prior version left an expiry on a protected record.
    await h.database.db.execute(sql`UPDATE resources.records SET phase='failed', retain_until=now()-interval '2 days' WHERE id=${protectedVolume.id}`);
    await h.database.db.execute(sql`UPDATE resources.records SET phase='failed', retain_until=now()-interval '1 day' WHERE id=${legacy.id}`);
    const uow = drizzleLedgerUnitOfWork(h.database.db);
    expect((await uow.read.records.retentionDue(1)).map((row) => row.id)).toEqual([legacy.id]);
    expect(await expireRetention(uow, h.clock)).toBe(1);
    expect((await h.module.api.get(protectedVolume.id))?.desired).toBe('present');
    expect((await h.module.api.get(legacy.id))?.desired).toBe('absent');
  });
});
