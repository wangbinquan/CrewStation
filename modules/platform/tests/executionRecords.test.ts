import { describe, expect, test } from 'bun:test';
import type { ProjectId, TaskId } from '@crewstation/contracts';
import { newId } from '@crewstation/kernel';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { executionRecords } from '../application/executionRecords';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('CLI 界面事实写入资源台账', () => {
  test('等待界面、就绪、降级、恢复与释放；重复事实不增加版本，Runner 投影不抹掉界面事实', async () => {
    const db = await createTestDatabase([resourcesMigrations]);
    try {
      const resources = createResourcesModule({ db: db.db, quotas: { limitFor: async () => 10 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true }).api;
      const owner = resources.owner('task-runtime'), bridge = executionRecords(resources);
      const id = newId('tsk') as TaskId, parentId = newId('tsk') as TaskId, projectId = newId('prj') as ProjectId;
      const declaration = { id, ref: id, kind: 'agent-execution' as const, purpose: 'development-cli' as const, parentId, projectId, spec: { children: [{ kind: 'Pod', namespace: 'cs-test', name: 'cli' }] } };
      await owner.declare(declaration);
      await resources.observe({ child: { ...declaration.spec.children[0]!, uid: 'pod-cli', phase: 'Running', ready: true } });
      const waiting = await owner.report(id, { conditions: [{ type: 'RunnerConnected', status: 'true' }] });
      expect(waiting).toMatchObject({ phase: 'starting', reason: { code: 'waiting-interface' } });
      await bridge.reportInterface(id, false);
      expect((await resources.get(id))?.version).toBe(waiting.version);
      await bridge.reportInterface(id, true);
      const ready = (await resources.get(id))!;
      expect(ready.phase).toBe('ready');
      await bridge.reportInterface(id, true);
      expect((await resources.get(id))?.version).toBe(ready.version);
      await owner.declare(declaration);
      await owner.report(id, { conditions: [{ type: 'RunnerConnected', status: 'true' }] });
      expect((await bridge.phases(parentId)).get(id)).toBe('ready');
      await bridge.reportInterface(id, false);
      expect((await resources.get(id))?.phase).toBe('degraded');
      await bridge.reportInterface(id, true);
      expect((await resources.get(id))?.phase).toBe('ready');
      await owner.requestRelease(id, { code: 'user', message: '结束' });
      const stopping = (await resources.get(id))!;
      await bridge.reportInterface(id, false);
      expect((await resources.get(id))?.version).toBe(stopping.version);
      expect((await bridge.phases(parentId)).get(id)).toBe('stopping');
      await resources.observe({ child: { ...declaration.spec.children[0]!, uid: 'pod-cli', phase: 'Running', ready: true }, gone: true });
      expect((await bridge.phases(parentId)).get(id)).toBe('stopped');
      expect((await bridge.phases(newId('tsk') as TaskId)).size).toBe(0);
      await bridge.reportInterface(newId('tsk') as TaskId, true);
      for (const patch of [{ kind: 'dev-workspace' as const }, { purpose: 'development-agent' as const }, { ref: 'different-reference' }]) {
        const otherId = newId('tsk') as TaskId;
        const other = await owner.declare({ ...declaration, id: otherId, ref: otherId, spec: { children: [] }, ...patch });
        await bridge.reportInterface(otherId, true);
        expect((await resources.get(otherId))?.version).toBe(other.version);
      }
      const foreignId = newId('tsk') as TaskId;
      const foreign = await resources.owner('other').declare({ ...declaration, id: foreignId, ref: foreignId, spec: { children: [] } });
      await bridge.reportInterface(foreignId, true);
      expect((await resources.get(foreignId))?.version).toBe(foreign.version);
    } finally { await db.drop(); }
  });
});
