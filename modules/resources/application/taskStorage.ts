import { TaskIdSchema } from '@crewstation/contracts';
import { conflict, forbidden, jsonHash, precondition } from '@crewstation/kernel';
import { z } from 'zod';
import type { ResourceDeclaration } from '../api/types';
import type { LedgerRecord } from '../domain/record';
import { protectedTaskVolume } from '../domain/taskStorage';
import type { LedgerScope } from '../ports/repositories';

const policy = z.strictObject({ taskId: TaskIdSchema, completionPolicy: z.literal('archive-and-delete') });
export async function guardTaskStorageDeclaration(scope: LedgerScope, module: string, input: ResourceDeclaration, previous?: LedgerRecord): Promise<void> {
  if (jsonHash(input.spec['finalizationPermit'] ?? null) !== jsonHash(previous?.spec['finalizationPermit'] ?? null)) throw forbidden('任务卷删除许可只能由资源中心确认');
  const value = input.spec['taskStorage'], old = previous?.spec['taskStorage'];
  if (old !== undefined && jsonHash(old) !== jsonHash(value ?? null)) throw conflict('任务卷终结策略与归属不可移除或替换');
  if (value === undefined) return;
  const storage = policy.parse(value);
  if (module !== 'task-runtime' || input.kind !== 'volume' || input.parentId !== storage.taskId || input.ref !== `${storage.taskId}/work`) throw forbidden('归档工作卷必须属于原业务任务');
  const parent = await scope.records.get(storage.taskId);
  if (!parent || parent.kind !== 'business-workspace' || parent.owner.module !== module || parent.projectId !== input.projectId) throw conflict('归档工作卷任务归属不匹配');
  if (input.spec['reclaim'] !== 'retain') throw conflict('归档工作卷不能跟随容器删除');
  if (previous && (old === undefined || jsonHash(previous.spec.children) !== jsonHash(input.spec.children))) throw conflict('既有工作卷的策略或物理目标不可替换');
}
/** Remains closed until the data receipt, consumer stop and original-UID delete permit handshake is installed. */
export function guardTaskVolumeRelease(record: LedgerRecord): void {
  if (protectedTaskVolume(record)) throw precondition('任务工作卷须通过终结归档与停止证明后回收', { code: 'finalization_required' });
}
