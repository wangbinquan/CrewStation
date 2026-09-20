import type { SubtaskId, TaskId } from '@crewstation/contracts';
import { notFound, validation } from '@crewstation/kernel';
import type { ResourceIdentityDirectory } from '@crewstation/persistence';
import type { LegacyBusinessProjection } from '../../api/legacyBusiness';

/** Version 1 protocol aliases are never accepted by the canonical management API. */
export function legacyBusinessIdentity(directory: ResourceIdentityDirectory): LegacyBusinessProjection {
  const resolve = async (kind: string, id: string): Promise<string> => {
    const canonical = await directory.resolve(kind, [id]);
    if (!canonical) throw notFound(`v1 ${kind}`, id);
    return canonical;
  };
  const declaration = async (kind: string, name: string, serviceId: string): Promise<string> => {
    const scopes = [serviceId, ...(await directory.aliases('service', serviceId)).filter((keys) => keys.length === 1 && /^svc_[0-9a-f]{32}$/.test(keys[0]!)).map((keys) => keys[0]!)];
    for (const scope of scopes) {
      const id = await directory.resolve(kind, [scope, name]); if (id) return id;
    }
    throw validation(`v1 ${kind} 未登记：${name}；请升级应用到 UUID 引用`);
  };
  const wire = async (kind: string, id: string, prefix?: string, scope?: string): Promise<string> => {
    const aliases = await directory.aliases(kind, id);
    const existing = aliases.find((keys) => prefix ? keys.length === 1 && keys[0]!.startsWith(`${prefix}_`) : scope ? keys.length === 2 : keys.length === 1);
    if (existing) return existing.at(-1)!;
    // A legacy wire symbol preserves all UUID bits and is registered against the existing resource.
    const alias = prefix ? `${prefix}_${id.replaceAll('-', '')}` : `r-${id.replaceAll('-', '')}`;
    await directory.bind('business_task', kind, scope ? [scope, alias] : [alias], id);
    return alias;
  };
  return {
    taskId: async (id) => await resolve('task', id) as TaskId,
    subtaskId: async (id) => await resolve('subtask', id) as SubtaskId,
    inputTask: async ({ profile, ...input }) => ({ ...input, ...(profile ? { taskProfileId: await resolve('task-profile', profile) } : {}) }),
    inputSubtask: async (input, serviceId) => {
      if (input.kind === 'command') return input;
      const { agentProfile, outputContract, ...rest } = input;
      return { ...rest, agentProfileId: await declaration('agent-profile', agentProfile, serviceId), ...(outputContract ? { outputContractId: await declaration('output-contract', outputContract, serviceId) } : {}) };
    },
    task: async ({ taskProfileId, ...task }) => ({ ...task, id: await wire('task', task.id, 'tsk'), serviceId: await wire('service', task.serviceId, 'svc'), profile: await wire('task-profile', taskProfileId) }),
    subtask: async ({ agentProfileId, agentProfileName: _agentName, outputContractId, outputContractName: _contractName, computeProfileId, ...subtask }, serviceId) => ({
      ...subtask, id: await wire('subtask', subtask.id, 'sub'), taskId: await wire('task', subtask.taskId, 'tsk'),
      ...(agentProfileId ? { agentProfile: await wire('agent-profile', agentProfileId, undefined, serviceId) } : {}),
      ...(outputContractId ? { outputContract: await wire('output-contract', outputContractId, undefined, serviceId) } : {}),
      ...(computeProfileId ? { compute: await wire('compute-profile', computeProfileId) } : {}),
    }),
  };
}
