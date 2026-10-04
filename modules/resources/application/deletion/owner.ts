import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionOwner } from '@crewstation/contracts';
import { ProjectDeletionStepResultSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { ResourceDeletionRepository } from '../../ports/deletion';
import type { ResourceDeletionPhysics, ResourceProjectDeletionOwner } from '../../api/projectDeletion';
import { compatiblePhysicalScope } from '../../domain/deletionScope';

export function resourceProjectDeletionOwner(repository: ResourceDeletionRepository, physics: ResourceDeletionPhysics, assertGrant: (context: ProjectDeletionContext) => Promise<void>): ResourceProjectDeletionOwner {
  const physicalStep = async (context: ProjectDeletionContext, step: keyof Pick<ResourceDeletionPhysics, 'stop' | 'purge' | 'prove' | 'verify'>) => {
    const result = ProjectDeletionStepResultSchema.parse(await physics[step](context));
    if (result.kind === 'done' && result.evidence.kind !== 'physical') throw precondition('资源阶段缺少实际物理来源证明');
    return result;
  };
  const inspect: ProjectDeletionOwner['inspect'] = async (target) => {
    const [metadata, physical] = await Promise.all([repository.inspect(target.id, target.namespace), physics.inspect(target)]);
    if (physical.participant !== 'resources' || physical.resources.some((entry) => entry.kind.startsWith('metadata:'))) throw precondition('资源物理盘点来源身份不符');
    const resources = [...metadata.resources, ...physical.resources], report: ProjectDeletionInventory = { participant: 'resources', complete: metadata.complete && physical.complete,
      revision: jsonHash(resources), resources, references: [...metadata.references, ...physical.references], blockers: [...metadata.blockers, ...physical.blockers] };
    return report;
  };
  return { participant: 'resources', inspect,
    observeTerminating: async (context) => {
      if (context.phase !== 'stop' || context.confirmed.participant !== 'resources') throw precondition('原 Pod 停止观测许可来源或阶段不符');
      await assertGrant(context); await repository.assertSealed(context); await physics.observeTerminating(context);
    }, run: async (context) => {
    await assertGrant(context);
    if (context.confirmed.participant !== 'resources') throw precondition('台账清理许可来源不符');
    if (context.phase === 'seal') {
      const sealed = await repository.seal(context), current = await physics.inspect(context.target);
      const expected = context.confirmed.resources.filter((entry) => !entry.kind.startsWith('metadata:'));
      const references = (items: ProjectDeletionInventory['references']) => jsonHash([...items].sort((a, b) => jsonHash(a).localeCompare(jsonHash(b))));
      if (!sealed || !current.complete || current.blockers.length || !compatiblePhysicalScope(expected, current.resources) || references(current.references) !== references(context.confirmed.references)) return { kind: 'blocked', blockers: [{ participant: 'resources', code: 'inventory-changed', message: '台账或原物理资源在确认后变化；已关闭准入，需核对原范围' }] };
      const protection = ProjectDeletionStepResultSchema.parse(await physics.seal(context));
      if (protection.kind !== 'done') return protection;
    } else await repository.assertSealed(context);
    if (context.phase === 'stop') return physicalStep(context, 'stop');
    if (context.phase === 'purge') return physicalStep(context, 'purge');
    if (context.phase === 'prove') return physicalStep(context, 'prove');
    if (context.phase === 'metadata') await repository.purgeMetadata(context);
    if (context.phase === 'verify') {
      if ((await repository.inspect(context.target.id, context.target.namespace)).resources.some((entry) => entry.count !== 0)) return { kind: 'blocked', blockers: [{ participant: 'resources', code: 'content-remains', message: '台账、子对象、消费者或历史证明仍有残留' }] };
      return physicalStep(context, 'verify');
    }
    return { kind: 'done', evidence: { kind: context.phase === 'namespace' ? 'not-applicable' : 'metadata', count: context.confirmed.resources.filter((entry) => entry.kind.startsWith('metadata:')).reduce((count, entry) => count + entry.count, 0),
      digest: jsonHash({ participant: 'resources', operationId: context.operationId, phase: context.phase, original: context.confirmed.revision }),
      description: context.phase === 'seal' ? '资源台账与实际调和写入的持久闭准入屏障生效' : context.phase === 'namespace' ? '命名空间物理终结由 cluster-control 按原 UID 执行' : '所有本项目台账、历史内容、消费者与证明已清除，仅保留最小防重放身份' } };
  } };
}
