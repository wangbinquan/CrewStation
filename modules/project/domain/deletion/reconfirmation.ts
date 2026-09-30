import type { AcceptProjectDeletion, ProjectDeletionInventory, ProjectDeletionPlan, ProjectDeletionTarget } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { DeletionOperationRecord } from './records';
import { deletionInventory } from './inventory';

export function confirmedRequestMatches(record: DeletionOperationRecord, projectId: string, input: AcceptProjectDeletion) {
  const originalPlan = record.operation.confirmations?.find((c) => c.requestKey === input.requestKey)?.planId ?? record.planId;
  if (record.operation.project.id !== projectId || originalPlan !== input.planId) throw conflict('删除请求键已用于其他确认材料');
}
export function assertReconfirmable(record: DeletionOperationRecord) {
  if (record.operation.state !== 'needs-attention' || record.operation.phase !== 'seal' || record.operation.receipts.some((r) => r.phase !== 'seal')) {
    throw conflict('仅封闭期间已阻塞的原操作可以重新盘点；已进入实际清理后不能换范围');
  }
}
const targetIdentity = (t: ProjectDeletionTarget) => ({ id: t.id, slug: t.slug, name: t.name, namespace: t.namespace, serviceId: t.serviceId,
  kind: t.kind, prodHost: t.prodHost, previewHost: t.previewHost, serviceHost: t.serviceHost });
const resourceShape = (r: ProjectDeletionInventory) => r.resources.map(({ kind, id, count, scope }) => ({ kind, id, count, scope: scope ?? 'physical' })).sort((a, b) => jsonHash(a).localeCompare(jsonHash(b)));
const referenceShape = (r: ProjectDeletionInventory) => r.references.map(({ kind, id, projectId }) => ({ kind, id, projectId })).sort((a, b) => jsonHash(a).localeCompare(jsonHash(b)));
export function reconfirmationInventory(target: ProjectDeletionTarget, previous: ProjectDeletionPlan, record: DeletionOperationRecord, reports: readonly ProjectDeletionInventory[]) {
  if (target.state !== 'deleting' || jsonHash(targetIdentity(target)) !== jsonHash(targetIdentity(previous.target))) throw precondition('原项目身份或删除屏障发生变化，不能认领其他目标');
  const fresh = deletionInventory(target, reports);
  const participants = fresh.participants.map((report) => {
    const original = previous.participants.find((p) => p.participant === report.participant)!;
    const changedPhysical = original.resources.some((resource) => {
      const current = report.resources.find((r) => r.kind === resource.kind && r.id === resource.id);
      return (current && (current.scope ?? 'physical') !== (resource.scope ?? 'physical')) ||
        resource.scope !== 'metadata' && (!current || (current.sourceIdentity ?? current.identity) !== (resource.sourceIdentity ?? resource.identity) || current.count !== resource.count);
    });
    const sealed = record.operation.receipts.some((r) => r.phase === 'seal' && r.participant === report.participant);
    const changedSealed = sealed && (jsonHash(resourceShape(original)) !== jsonHash(resourceShape(report)) || jsonHash(referenceShape(original)) !== jsonHash(referenceShape(report)));
    if (changedPhysical || changedSealed) return { ...report, complete: false, blockers: [...report.blockers, { participant: report.participant,
      code: changedPhysical ? 'original-identity-changed' : 'sealed-scope-changed', message: changedPhysical ? '原物理实例已消失、换身份或改变分类，不能通过重新确认认领替换物' : '已封闭来源的原资源范围发生变化，需修复该来源的屏障，保留原证明' }] };
    return sealed && report.complete && !report.blockers.length ? original : report;
  });
  return deletionInventory(target, participants);
}
