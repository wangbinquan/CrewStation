// Real factory + PostgreSQL: the original Task cleanup calls a second owner that reads Task identity.
import { describe, expect, test } from 'bun:test';
import { assertSharedDatabaseAdmissionActive, withSharedDatabaseAdmission } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { TaskRuntimeModuleApi } from '../../api/moduleApi';
import { runtimeWorkModuleFixture } from './workModuleFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('Task readonly identity during another original database admission', () => {
  test('reads the actual original environment without borrowing or expanding the other owner admission', async () => {
    let reads = 0, before: Awaited<ReturnType<TaskRuntimeModuleApi['getEnvironment']>>;
    const f = await runtimeWorkModuleFixture(async (original) => ({ sources: {
      configEnv: async () => withSharedDatabaseAdmission(original.database.db, 'dev-session.project-admission:' + original.project, async () => {
        assertSharedDatabaseAdmissionActive(original.database.db, 'dev-session.project-admission:' + original.project);
        expect(() => assertSharedDatabaseAdmissionActive(original.database.db, 'task-runtime.project-admission:' + original.project)).toThrow('Original database admission has exited');
        const actual = await api.getEnvironment(original.parent); reads++;
        expect(actual).toMatchObject({ id: original.parent, projectId: original.project });
        expect(actual).toEqual(before);
        // A readonly original identity is not a grant for a Task mutation under another owner.
        await expect(api.touch(original.parent)).rejects.toThrow('Original database admission has exited');
        return {};
      }), dataEnv: async () => ({}), taskDataEnv: async () => ({}),
    } }));
    const api = f.module.api;
    try {
      before = await api.getEnvironment(f.parent);
      const result = await api.createEnvironment({ serviceId: f.service, kind: 'business', volumeMode: 'follow-container' });
      expect(result.state).toBe('creating'); expect(reads).toBe(1);
      expect(await api.getEnvironment(f.parent)).toEqual(before);
      await f.stop();
      expect((await f.work.history(f.project)).every((row) => row.exited)).toBe(true);
    } finally { await f.drop(); }
  });
});
