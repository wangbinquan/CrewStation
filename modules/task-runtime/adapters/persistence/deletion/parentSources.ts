import { ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { DevelopmentParentEpochSchema, developmentParentEpochHash } from '../../../domain/development/parentEnding';
import { DevelopmentParentRebuildBindingSchema } from '../../../domain/development/parentRebuildBinding';
import { sameRuntimeScope } from './contentSources';
import type { RuntimeContentSources } from './contentSources';
import { runtimeObject, runtimeString } from './rowStore';

/** Immutable historical epochs remain distinct from the current parent Pod or an accepted successor rebuild. */
export class RuntimeParentSources {
  constructor(private readonly sources: RuntimeContentSources) {}
  async ending(key: string) {
    const id = await this.sources.aliasId('parent-ending', key);
    const row = id ? await this.sources.rows.get('development_parent_endings', id) : undefined;
    if (!row) throw precondition('运行环境原父结束来源缺失');
    const epoch = DevelopmentParentEpochSchema.parse(row['epoch']);
    if (epoch.parentId !== row['parent_id'] || epoch.projectId !== row['project_id'] || developmentParentEpochHash(epoch) !== row['epoch_hash'])
      throw precondition('运行环境原父结束受理范围冲突');
    const parent = await this.sources.rows.get('environments', epoch.parentId);
    if (!parent || parent['kind'] !== 'dev-session' || parent['native'] !== null || parent['service_id'] !== epoch.serviceId || parent['project_id'] !== epoch.projectId)
      throw precondition('运行环境原父结束缺少实际原开发工作区');
    if (row['membership_frozen'] === true) {
      const members = await this.sources.memberCount(id!);
      if (!Number.isSafeInteger(row['member_count']) || row['member_count'] !== members) throw precondition('运行环境原父冻结成员数与完整集合不符');
    }
    const facts = [await this.sources.root('project', epoch.projectId), await this.sources.root('service', epoch.serviceId), await this.sources.task(epoch.parentId)];
    const origin = this.sources.remember('parent-ending', key, { ...sameRuntimeScope(facts), id: id!, revision: jsonHash({ kind: 'parent-ending', id, epoch: row['epoch_hash'], facts }) });
    return { row, epoch, origin };
  }
  async binding(value: unknown, parentId: string) {
    const binding = DevelopmentParentRebuildBindingSchema.parse(value), ending = await this.ending(binding.endingId);
    if (ending.epoch.parentId !== parentId || ending.row['epoch_hash'] !== binding.epochHash)
      throw precondition('运行环境恢复和原父结束关系冲突');
    if (binding.kind === 'completed-ending' && (ending.row['phase'] !== 'complete' || jsonHash(ending.row['completion_witness']) !== binding.completionWitnessHash))
      throw precondition('运行环境恢复的原完成证明不符');
    return ending.origin;
  }
  async rebuild(key: string) {
    const id = await this.sources.aliasId('rebuild', key), row = id ? await this.sources.rows.get('environment_rebuilds', id) : undefined;
    if (!row) throw precondition('运行环境原恢复来源缺失');
    const task = runtimeString(row['task_id']), input = runtimeObject(row['input']);
    if (ResourceIdSchema.parse(input['expectedTaskId']) !== task) throw precondition('运行环境恢复的原任务关系不符');
    const parent = await this.sources.rows.get('environments', task);
    if (!parent || parent['kind'] !== 'dev-session' || parent['native'] !== null) throw precondition('运行环境恢复缺少实际原开发工作区');
    const facts = [await this.sources.root('project', runtimeString(row['project_id'])), await this.sources.task(task)];
    if (row['development_parent_binding'] !== null) facts.push(await this.binding(row['development_parent_binding'], task));
    if (row['legacy_cluster'] !== null) {
      const legacy = runtimeObject(row['legacy_cluster']);
      await this.sources.legacy('task', legacy['taskId'], task); await this.sources.legacy('rebuild', legacy['rebuildId'], id);
    }
    if (row['legacy_input'] !== null) await this.sources.legacy('task', runtimeObject(row['legacy_input'])['expectedTaskId'], task);
    return this.sources.remember('rebuild', key, { ...sameRuntimeScope(facts), id: id!, revision: jsonHash({ kind: 'rebuild', id, task, facts }) });
  }
}
