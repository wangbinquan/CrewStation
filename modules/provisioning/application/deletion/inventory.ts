import { PROJECT_DELETION_PARTICIPANTS, ProjectDeletionInventorySchema } from '@crewstation/contracts';
import type { ProjectDeletionInventory, ProjectDeletionOwner, ProjectId } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Logger } from '@crewstation/kernel';
import type { ProjectDeletionIntents } from '../../ports/projectDeletions';

export function assertDeletionOwners(owners: readonly ProjectDeletionOwner[]) {
  const names = owners.map((owner) => owner.participant);
  if (new Set(names).size !== PROJECT_DELETION_PARTICIPANTS.length || names.length !== PROJECT_DELETION_PARTICIPANTS.length ||
    !PROJECT_DELETION_PARTICIPANTS.every((name) => names.includes(name))) throw precondition('永久删除必须登记全部项目资源 owner');
}
export async function collectDeletionInventory(intents: ProjectDeletionIntents, owners: readonly ProjectDeletionOwner[], projectId: ProjectId, logger?: Logger): Promise<ProjectDeletionInventory[]> {
  const target = await intents.scope(projectId);
  // Each owner holds its own snapshot and may call public ownership sources through the same pool.
  // Serial reads leave capacity for those sources instead of exhausting every connection with snapshots.
  const reports: ProjectDeletionInventory[] = [];
  for (const owner of owners) {
    try {
      const report = ProjectDeletionInventorySchema.parse(await owner.inspect(target));
      if (report.participant !== owner.participant) throw precondition('清理来源身份不匹配'); reports.push(report);
    } catch (error) {
      // Source locations identify the failed adapter without logging exception bodies, SQL or credentials.
      const sourceLocations = error instanceof Error ? [...new Set(error.stack?.match(/\/app\/(?:modules|packages)\/[a-zA-Z0-9/_-]+\.(?:ts|js):\d+:\d+/g) ?? [])].slice(0, 8) : [];
      try { logger?.warn('project deletion inventory source failed', { projectId, participant: owner.participant, sourceLocations }); }
      catch { /* A diagnostic sink cannot change the incomplete source report. */ }
      reports.push({ participant: owner.participant, revision: jsonHash({ participant: owner.participant, unavailable: true }), complete: false, resources: [], references: [],
        blockers: [{ participant: owner.participant, code: 'source-unavailable', message: `${owner.participant} 无法完成资源盘点，请恢复该来源后重新盘点` }] });
    }
  }
  if (jsonHash(await intents.scope(projectId)) !== jsonHash(target)) {
    const own = reports.find((r) => r.participant === 'project')!; own.complete = false;
    own.blockers.push({ participant: 'project', code: 'scope-changed', message: '盘点期间项目发生变化，请重新盘点并确认' });
  }
  return reports;
}
