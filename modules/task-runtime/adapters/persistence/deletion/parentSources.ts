import { ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { sameRuntimeScope } from './contentSources';
import type { RuntimeContentSources } from './contentSources';
import { runtimeObject, runtimeString } from './rowStore';

/** A rebuild's original workspace and project remain its immutable deletion origin. */
export class RuntimeParentSources {
  constructor(private readonly sources: RuntimeContentSources) {}
  async rebuild(key: string) {
    const id = await this.sources.aliasId('rebuild', key), row = id ? await this.sources.rows.get('environment_rebuilds', id) : undefined;
    if (!row) throw precondition('运行环境原恢复来源缺失');
    const task = runtimeString(row['task_id']), input = runtimeObject(row['input']);
    if (ResourceIdSchema.parse(input['expectedTaskId']) !== task) throw precondition('运行环境恢复的原任务关系不符');
    const parent = await this.sources.rows.get('environments', task);
    if (!parent || parent['kind'] !== 'dev-session' || parent['native'] !== null) throw precondition('运行环境恢复缺少实际原开发工作区');
    const facts = [await this.sources.root('project', runtimeString(row['project_id'])), await this.sources.task(task)];
    if (row['legacy_cluster'] !== null) {
      const legacy = runtimeObject(row['legacy_cluster']);
      await this.sources.legacy('task', legacy['taskId'], task); await this.sources.legacy('rebuild', legacy['rebuildId'], id);
    }
    if (row['legacy_input'] !== null) await this.sources.legacy('task', runtimeObject(row['legacy_input'])['expectedTaskId'], task);
    return this.sources.remember('rebuild', key, { ...sameRuntimeScope(facts), id: id!, revision: jsonHash({ kind: 'rebuild', id, task, facts }) });
  }
}
