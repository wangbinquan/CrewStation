import { describe, expect, test } from 'bun:test';
import type { ProjectId } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { runtimeContentSnapshot } from '../../adapters/persistence/deletion/inspection';
import type { RuntimeDeletionSources } from '../../ports/deletion/sources';
import { developmentParentEndingStorageFixture } from '../developmentParentEndingStorageFixture';
import { rebuildFixture } from '../rebuildFixture';

const available = await testDatabaseAvailable();
function originalRoots(project: ProjectId, service: string): RuntimeDeletionSources {
  return { resolve: async (kind, key) => {
    if (kind === 'project' && key === project || kind === 'service' && key === service)
      return { complete: true, id: key, scope: 'project', projectIds: [project], revision: jsonHash({ kind, key, project }) };
    return undefined;
  } };
}
describe.skipIf(!available)('runtime deletion inspection reads actual module-created records (controlled public roots)', () => {
  test('keeps the original complete frozen parent membership and every native execution', async () => {
    const f = await developmentParentEndingStorageFixture();
    try {
      const children = await f.seed(3), ending = await f.admit();
      const inventory = await runtimeContentSnapshot(f.db, originalRoots(f.projectId, f.serviceId), f.projectId);
      expect(inventory.inventory.complete).toBe(true);
      expect(inventory.inventory.resources.find((row) => row.id === 'development_parent_ending_children')?.count).toBe(3);
      for (const id of children) expect(inventory.contents.some((row) => row.table === 'environments' && row.key.includes(id))).toBe(true);
      expect(inventory.origins.find((row) => row.kind === 'parent-ending' && row.key === ending.id)?.projectId).toBe(f.projectId);
      expect(JSON.stringify(inventory)).not.toContain(f.parent.runnerTokenHash);
    } finally { await f.tdb.drop(); }
  });
  test('a legitimate admitted rebuild and its current render are not rejected as contradictory history', async () => {
    const f = await rebuildFixture();
    try {
      const input = await f.request(), accepted = await f.runtime.api.requestRebuild(f.projectId, input);
      const inventory = await runtimeContentSnapshot(f.tdb.db, originalRoots(f.projectId, f.serviceId), f.projectId);
      expect(inventory.inventory.complete).toBe(true);
      expect(inventory.contents.some((row) => row.table === 'environment_rebuilds' && row.key.includes(accepted.id))).toBe(true);
      expect(inventory.origins.find((row) => row.kind === 'rebuild' && row.key === accepted.id)?.projectId).toBe(f.projectId);
    } finally { await f.close(); }
  });
});
