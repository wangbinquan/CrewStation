import { ConfirmProjectDeletionRepairSchema, ProjectDeletionRepairListSchema } from '@crewstation/contracts';
import type { Actor, ProjectDeletionOwner, ProjectId, UserId } from '@crewstation/contracts';
import { forbidden, precondition } from '@crewstation/kernel';
import type { ProjectDeletionIntents } from '../../ports/projectDeletions';
import type { ProjectDeletionController } from '../../api/deletion';

/** Every mutation goes to exactly one public owner. This coordinator never persists another module's facts. */
export function deletionOperatorRepairs(intents: ProjectDeletionIntents, owners: readonly ProjectDeletionOwner[], isAdmin: (id: UserId) => Promise<boolean>): NonNullable<ProjectDeletionController['repairs']> {
  const expected = ['business-task', 'gateway', 'provisioning', 'data-control'];
  const scope = async (actor: Actor, id: ProjectId) => {
    if (!await isAdmin(actor.userId)) throw forbidden('只有当前管理员可以确认旧资源归属');
    return intents.scope(id);
  };
  return {
    inspect: async (actor, id) => {
      const target = await scope(actor, id), items = [], blockers: string[] = [];
      for (const name of expected) {
        const owner = owners.find((entry) => entry.participant === name);
        if (!owner?.repairs) { blockers.push(name + ' 当前确权来源尚未装配'); continue; }
        try { items.push(...await owner.repairs.inspect(target)); }
        catch { blockers.push(name + ' 未能读尽当前确权候选，请恢复来源后重读'); }
      }
      return ProjectDeletionRepairListSchema.parse({ version: 'operator-confirmed/v1', projectId: id, complete: !blockers.length, items, blockers });
    },
    confirm: async (actor, id, raw) => {
      const target = await scope(actor, id), input = ConfirmProjectDeletionRepairSchema.parse(raw), owner = owners.find((entry) => entry.participant === input.owner);
      if (!owner?.repairs) throw precondition('该资源 owner 的当前确权来源尚未装配');
      return owner.repairs.confirm(target, { ...actor, isAdmin: true }, input);
    },
  };
}
