import { describe, expect, test } from 'bun:test';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { resourceIdentityDirectory } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { releaseMigrations } from '../wiring';
import { releaseImageFixture } from './runtimeImageFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('release public infrastructure origins (actual PG; no physical source claim)', () => {
  test('canonical/legacy origins match without tag, manifest or pipeline text; unknown and conflicting original sources block', async () => {
    const f = await releaseImageFixture();
    try {
      const released = await f.runtime.api.publish(f.actor, f.serviceId, { branch: 'main', version: 'patch' });
      const origin = await f.runtime.api.originalInfrastructureOwnership(released.id);
      expect(origin).toMatchObject({ complete: true, id: released.id, scope: 'project', projectIds: [f.projectId] });
      const directory = resourceIdentityDirectory(f.db, () => [releaseMigrations]);
      await directory.bind('release', 'release', ['private-old-release'], released.id);
      expect(await f.runtime.api.originalInfrastructureOwnership('private-old-release', 'legacy')).toEqual(origin);
      expect(await f.runtime.api.originalInfrastructureOwnership(released.id, 'legacy')).toEqual(origin);
      expect(await f.runtime.api.originalInfrastructureOwnership(newResourceId())).toBeUndefined();
      expect(await f.runtime.api.originalInfrastructureOwnership('unknown-release', 'legacy')).toBeUndefined();
      await expect(f.runtime.api.originalInfrastructureOwnership('v0.0.1')).rejects.toThrow();
      await expect(f.runtime.api.originalInfrastructureOwnership(released.id, 'unknown' as never)).rejects.toThrow('未登记');
      for (const privateField of ['private-old-release', 'manifest', 'pipeline', 'v0.0.']) expect(JSON.stringify(origin)).not.toContain(privateField);
      const current = (await f.uow.read.releases.getById(released.id))!;
      await f.uow.read.releases.update({ ...current, message: 'private updated pipeline result' });
      expect(await f.runtime.api.originalInfrastructureOwnership(released.id)).toEqual(origin);
      // Only this isolated database disables its control guard to reproduce a corrupt retained source.
      await f.db.execute(sql`ALTER TABLE release.deletion_entities DISABLE TRIGGER release_project_control_guard`);
      await f.db.execute(sql`INSERT INTO release.deletion_entities VALUES('release',${released.id},${newResourceId()})`);
      await f.db.execute(sql`ALTER TABLE release.deletion_entities ENABLE TRIGGER release_project_control_guard`);
      await expect(f.runtime.api.originalInfrastructureOwnership(released.id)).rejects.toThrow('归属冲突');
      await directory.bind('release', 'release', [released.id], newResourceId());
      await expect(f.runtime.api.originalInfrastructureOwnership(released.id)).rejects.toThrow('目录冲突');
      expect(origin?.revision).toBe(jsonHash({ kind: 'release', id: released.id, projectId: f.projectId }));
    } finally { await f.close(); }
  });
});
