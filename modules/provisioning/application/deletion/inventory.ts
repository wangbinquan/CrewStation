import { PROJECT_DELETION_PARTICIPANTS, ProjectDeletionInventorySchema } from '@crewstation/contracts';
import type { ProjectDeletionInventory, ProjectDeletionOwner, ProjectId } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { ProjectDeletionIntents } from '../../ports/projectDeletions';

export function assertDeletionOwners(owners: readonly ProjectDeletionOwner[]) {
  const names = owners.map((owner) => owner.participant);
  if (new Set(names).size !== PROJECT_DELETION_PARTICIPANTS.length || names.length !== PROJECT_DELETION_PARTICIPANTS.length ||
    !PROJECT_DELETION_PARTICIPANTS.every((name) => names.includes(name))) throw precondition('永久删除必须登记全部项目资源 owner');
}
export async function collectDeletionInventory(intents: ProjectDeletionIntents, owners: readonly ProjectDeletionOwner[], projectId: ProjectId): Promise<ProjectDeletionInventory[]> {
  const target = await intents.scope(projectId);
  const reports = await Promise.all(owners.map(async (owner): Promise<ProjectDeletionInventory> => {
    try {
      const report = ProjectDeletionInventorySchema.parse(await owner.inspect(target));
      if (report.participant !== owner.participant) throw precondition('清理来源身份不匹配'); return report;
    } catch {
      return { participant: owner.participant, revision: jsonHash({ participant: owner.participant, unavailable: true }), complete: false, resources: [], references: [],
        blockers: [{ participant: owner.participant, code: 'source-unavailable', message: `${owner.participant} 无法完成资源盘点，请恢复该来源后重新盘点` }] };
    }
  }));
  if (jsonHash(await intents.scope(projectId)) !== jsonHash(target)) {
    const own = reports.find((r) => r.participant === 'project')!; own.complete = false;
    own.blockers.push({ participant: 'project', code: 'scope-changed', message: '盘点期间项目发生变化，请重新盘点并确认' });
  }
  return reports;
}
