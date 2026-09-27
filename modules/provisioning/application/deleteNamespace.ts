import type { Actor, UserId } from '@crewstation/contracts';
import { forbidden, notFound, precondition } from '@crewstation/kernel';
import type { NamespaceCleanup } from '../ports/namespaceCleanup';

/** 归档不自动删除；只有管理员明确操作且资源已清空，才把删除意图交给调和器。 */
export async function deleteNamespace(cleanup: NamespaceCleanup | undefined, isAdmin: (id: UserId) => Promise<boolean>, actor: Actor, id: string): Promise<void> {
  if (!await isAdmin(actor.userId)) throw forbidden('只有管理员可以删除归档项目的命名空间');
  if (!cleanup) throw precondition('命名空间清理尚未配置');
  const record = await cleanup.record(id);
  if (!record || record.kind !== 'namespace' || record.owner.module !== 'provisioning' || !record.projectId) throw notFound('项目命名空间记录', id);
  const project = await cleanup.project(record.projectId);
  if (project.state !== 'archived') throw precondition('请先归档项目，再处理命名空间');
  const child = record.children.find((entry) => entry.kind === 'Namespace');
  if (!child?.uid || child.name !== project.namespace) throw precondition('命名空间实例尚未确认，请刷新后重试');
  await cleanup.retire(id, child.uid, (name, children) => cleanup.inspect(name, child.uid!, children));
}
