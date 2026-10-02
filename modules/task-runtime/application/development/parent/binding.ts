import { requirePublishedParentRebuild } from '../../../domain/development/parentRebuildPublication';
import { precondition } from '@crewstation/kernel';
import type { EnvironmentRebuild } from '../../../domain/environmentRebuild';
import { readDevelopmentParentEnding } from '../../../domain/development/parentEnding';
import { DevelopmentParentRebuildBindingSchema } from '../../../domain/development/parentRebuildBinding';
import type { TaskEnvironment } from '../../../domain/taskEnvironment';
import type { RepositoryScope } from '../../../ports/unitOfWork';

/** Pending acceptance is private and need not replace the live parent's rebuildId. */
export async function currentDevelopmentParentRebuild(scope: RepositoryScope, environment: TaskEnvironment) {
  const pointer = readDevelopmentParentEnding(environment);
  if (!pointer || !scope.parentEnding) return undefined;
  const ending = await scope.parentEnding.endings.get(pointer.endingId);
  if (!ending || ending.epochHash !== pointer.epochHash || ending.parentId !== environment.id || ending.projectId !== environment.projectId || ending.phase !== pointer.phase)
    throw precondition('原父恢复受理身份尚未恢复');
  const claim = pointer.phase === 'complete' ? await scope.parentEnding.claims.get(ending.id) : undefined;
  const id = claim?.state === 'pending' ? claim.currentRebuildId : ending.phase !== 'complete' && ending.operation === 'rebuild' ? ending.intent['rebuildId'] : undefined;
  if (typeof id !== 'string') return undefined;
  const record = await scope.rebuilds.get(id);
  if (!record || record.taskId !== environment.id || record.projectId !== environment.projectId) throw precondition('原父 queued 恢复记录尚未恢复');
  const binding = DevelopmentParentRebuildBindingSchema.parse(record.developmentParentBinding);
  if (binding.endingId !== ending.id || binding.epochHash !== ending.epochHash || claim && (binding.kind !== 'completed-ending' || binding.claimRevision !== claim.revision))
    throw precondition('原父恢复占位或严格绑定不一致');
  return record;
}

/** Runner readiness uses the same original SQL source/claim as provisioning; malformed selection never becomes legacy. */
export async function requireCurrentParentRebuild(scope: RepositoryScope, environment: TaskEnvironment, record: EnvironmentRebuild | undefined): Promise<boolean> {
  const selected = record && Object.hasOwn(record, 'developmentParentBinding') || !!environment.render?.rebuild && Object.hasOwn(environment.render.rebuild, 'developmentParentSelection');
  if (!selected) return false;
  if (!record || !Object.hasOwn(record, 'developmentParentBinding') || !scope.parentEnding) throw precondition('原恢复严格绑定尚未恢复');
  const binding = DevelopmentParentRebuildBindingSchema.parse(record.developmentParentBinding), ending = await scope.parentEnding.endings.get(binding.endingId);
  if (!ending) throw precondition('原恢复完成来源尚未恢复');
  requirePublishedParentRebuild(environment, record, ending);
  if (binding.kind === 'completed-ending') {
    const claim = await scope.parentEnding.claims.get(ending.id);
    if (!claim || claim.state !== 'published' || claim.currentRebuildId !== record.id || claim.revision !== binding.claimRevision) throw precondition('原恢复发布占位已变化');
  }
  return true;
}
