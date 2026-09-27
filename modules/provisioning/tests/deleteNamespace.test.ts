import { expect, test } from 'bun:test';
import type { Actor, ProjectId, UserId } from '@crewstation/contracts';
import { deleteNamespace } from '../application/deleteNamespace';
import type { NamespaceCleanup } from '../ports/namespaceCleanup';

test('命名空间清理每次核实管理员、归档状态、资源归属和实际命名空间', async () => {
  const actor: Actor = { userId: 'admin' as UserId, isAdmin: true };
  let state = 'active', namespace = 'cs-demo', called = 0;
  let record: Awaited<ReturnType<NamespaceCleanup['record']>> = { kind: 'namespace', projectId: 'project' as ProjectId, owner: { module: 'provisioning' }, children: [{ kind: 'Namespace', name: 'cs-demo', uid: 'uid' }] };
  const cleanup: NamespaceCleanup = { project: async () => ({ state, namespace }), record: async () => record,
    retire: async (_id, uid, inspect) => { expect(uid).toBe('uid'); await inspect('cs-demo', []); },
    inspect: async (name, uid) => { expect([name, uid]).toEqual(['cs-demo', 'uid']); called++; } };
  await expect(deleteNamespace(cleanup, async () => false, actor, 'record')).rejects.toMatchObject({ kind: 'forbidden' });
  await expect(deleteNamespace(undefined, async () => true, actor, 'record')).rejects.toThrow('尚未配置');
  await expect(deleteNamespace(cleanup, async () => true, actor, 'record')).rejects.toThrow('先归档');
  state = 'archived'; namespace = 'cs-other';
  await expect(deleteNamespace(cleanup, async () => true, actor, 'record')).rejects.toThrow('实例尚未确认');
  namespace = 'cs-demo';
  await deleteNamespace(cleanup, async () => true, actor, 'record'); expect(called).toBe(1);
  record = undefined;
  await expect(deleteNamespace(cleanup, async () => true, actor, 'record')).rejects.toMatchObject({ kind: 'not_found' });
});
