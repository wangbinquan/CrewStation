import { PROJECT_DELETION_PARTICIPANTS, ProjectDeletionInventorySchema } from '@crewstation/contracts';
import type { ProjectDeletionBlocker, ProjectDeletionInventory, ProjectDeletionTarget } from '@crewstation/contracts';
import { jsonHash, validation } from '@crewstation/kernel';

/** 排序只归一资源集合；完整性来自所有 owner 的明确回执，不能来自数量或截断的第一页。 */
export function deletionInventory(target: ProjectDeletionTarget, reports: readonly ProjectDeletionInventory[]) {
  const unique = new Set<string>();
  const participants = reports.map((report) => {
    const item = ProjectDeletionInventorySchema.parse(report);
    if (unique.has(item.participant)) throw validation('删除盘点参与者重复', { participant: item.participant });
    unique.add(item.participant);
    return { ...item, resources: [...item.resources].sort((a, b) => jsonHash(a).localeCompare(jsonHash(b))),
      references: [...item.references].sort((a, b) => jsonHash(a).localeCompare(jsonHash(b))), blockers: [...item.blockers].sort((a, b) => jsonHash(a).localeCompare(jsonHash(b))) };
  }).sort((a, b) => a.participant.localeCompare(b.participant));
  const blockers: ProjectDeletionBlocker[] = participants.flatMap((p) => p.blockers);
  for (const participant of PROJECT_DELETION_PARTICIPANTS) {
    const report = participants.find((p) => p.participant === participant);
    if (!report?.complete) blockers.push({ participant, code: 'inventory-incomplete', message: `${participant} 未提供完整盘点，不能开始销毁` });
  }
  return { participants, blockers, complete: blockers.length === 0, digest: jsonHash({ target, participants, owners: PROJECT_DELETION_PARTICIPANTS }) };
}
