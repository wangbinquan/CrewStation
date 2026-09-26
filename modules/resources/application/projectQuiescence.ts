import type { ProjectId, ResourceKind } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';
import type { LedgerScope } from '../ports/repositories';

const CONSUMERS: readonly ResourceKind[] = ['dev-workspace', 'business-workspace', 'agent-execution', 'service-slot', 'build-job', 'migration-job'];

/** 与启动声明使用同一项目锁，空闲检查包括排队、启动、失败保留和回收中的使用者。 */
export async function lockIdleProject(scope: LedgerScope, projectId: ProjectId): Promise<void> {
  await scope.locks.lock(projectId);
  const count = await scope.records.countConsumers(projectId, CONSUMERS);
  if (count > 0) throw conflict('项目仍有运行、待启动或待回收的使用者，请先结束这些资源再轮换口令', { count });
}

/** 轮换意图持久化后到完成前，新的工作负载不能越过启动受理；进程崩溃也不解除。 */
export async function guardCredentialRotation(scope: LedgerScope, projectId: ProjectId | undefined, kind: ResourceKind): Promise<void> {
  if (!projectId || !CONSUMERS.includes(kind)) return;
  await scope.locks.lock(projectId);
  const databases = await scope.records.list({ projectId, kind: 'database' });
  if (databases.length >= 2000 || databases.some((record) => record.conditions.some((entry) => entry.type === 'CredentialRotating' && entry.status === 'true'))) {
    throw conflict('项目数据库口令正在轮换，完成后再启动；上次轮换失败时请管理员重试');
  }
}
