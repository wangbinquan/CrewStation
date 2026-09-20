import type { Actor, ClusterOperation, ClusterResource, UserId } from '@crewstation/contracts';
import { isPlatformError, precondition } from '@crewstation/kernel';
import { objectRecord } from '../domain/inventory';
import { projectResources } from '../domain/projection';
import type { ClusterDeps } from './dependencies';
import { liveInspection, sameInspection } from './operations';
import { requireAdmin } from './queries';
const terminal = new Set(['succeeded', 'failed', 'needs-attention']);
export async function executeOperation(deps: ClusterDeps, id: string, fence: number, heartbeat: () => Promise<boolean>, resumeCount = 0): Promise<void> {
  let op = await deps.repository.operation(id); if (!op || terminal.has(op.phase) || (op.resumeCount ?? 0) !== resumeCount) return;
  fence += resumeCount * 1_000_000;
  const actor: Actor = { userId: op.actorId as UserId, isAdmin: true };
  const save = async (patch: Partial<ClusterOperation>) => { if (!await heartbeat()) throw precondition('工作器租约已转移'); const now = deps.clock.now(); op = { ...op!, ...patch, updatedAt: now.toISOString(), durationMs: now.getTime() - Date.parse(op!.createdAt), ...(patch.phase && terminal.has(patch.phase) ? { finishedAt: now.toISOString() } : {}) }; if (!await deps.repository.update(op, fence)) throw precondition('工作器记录已被接管'); };
  try {
    if (op.phase !== 'observing') await requireAdmin(deps, actor);
    const saved = await deps.repository.inspection(op.inspectionId); if (!saved) throw precondition('操作检查记录不存在');
    const domain = saved.inspection.capability.executionRoute !== 'kubernetes';
    if (op.phase === 'queued' || op.phase === 'executing') {
      const already = !domain && await deps.cluster.hasApplied(op.target, op.params, op.operationId);
      if (!already) {
        if (op.phase === 'queued') sameInspection(saved.inspection, await liveInspection(deps, actor, op.target, op.params));
        // Domain commands persist their own idempotent intent; native writes use the same marker and UID CAS on recovery.
        await save({ phase: 'executing', reason: '正在执行' });
        if (domain) { const result = await deps.domains.execute(actor, op, saved.inspection); await save({ domainOperationId: result.operationId }); }
        else { await deps.cluster.apply(op.target, op.params, op.operationId); }
      }
      await save({ phase: 'observing', observationStartedAt: deps.clock.now().toISOString(), reason: '已提交，等待实际状态收敛' });
    }
    while (deps.clock.now().getTime() - Date.parse(op.observationStartedAt ?? op.createdAt) < deps.observationMs) {
      if (!await heartbeat()) return;
      const state: { done: boolean; failed?: boolean; reason: string; after?: ClusterResource } = domain ? await deps.domains.observe(op) : await observeNative(deps, op);
      if (state.done) { await save({ phase: state.failed ? 'failed' : 'succeeded', reason: state.reason, httpStatus: state.failed ? 412 : 200, ...('after' in state && state.after ? { after: state.after } : {}) }); await deps.repository.requestRefresh(); return; }
      await save({ reason: state.reason }); await deps.wait(2000);
    }
    await save({ phase: 'needs-attention', resumePhase: 'observing', httpStatus: 504, reason: `观察期限内尚未收敛：${op.reason}。请核对资源实际状态，已受理的变更不会自动回滚。` });
  } catch (error) {
    if (!await heartbeat()) return;
    const status = isPlatformError(error) ? ({ conflict: 409, forbidden: 403, not_found: 404, validation: 400, precondition: 412 } as Record<string, number>)[error.kind] ?? 503 : 503;
    const definitive = op.phase === 'queued' || op.phase === 'executing' && [400, 403, 404, 409, 412].includes(status);
    await save({ phase: definitive ? 'failed' : 'needs-attention', resumePhase: op.phase === 'observing' ? 'observing' : 'executing', httpStatus: status, reason: String(error) });
  }
}
async function observeNative(deps: ClusterDeps, op: ClusterOperation) {
  const live = await deps.cluster.get(op.target);
  if (op.action === 'delete') return { done: !live || live.metadata.uid !== op.target.uid, reason: live?.metadata.uid === op.target.uid ? '等待原实例终止（可能仍有 finalizer）' : '原 UID 已删除；同名替代对象不受影响' };
  if (!live || live.metadata.uid !== op.target.uid) return { done: true, failed: true, reason: '目标实例已消失或被替换' };
  const after = projectResources([live], await deps.metadata.read(), deps.systemNamespace, deps.catalog, deps.clock.now().toISOString())[0];
  if (!after) return { done: true, failed: true, reason: '资源归属已改变' };
  const status = objectRecord(live.status);
  const updated = op.target.kind === 'DaemonSet' ? Number(status.updatedNumberScheduled ?? 0) === after.desired : Number(status.updatedReplicas ?? 0) === after.desired;
  const revisionReady = op.target.kind !== 'StatefulSet' || status.currentRevision === status.updateRevision;
  const generationReady = (after.observedGeneration ?? 0) >= (after.generation ?? 0), ready = after.ready && generationReady;
  const done = op.action === 'restart' ? ready && updated && revisionReady && after.actual === after.desired && (after.generation ?? 0) > (op.target.generation ?? 0) : ready && after.desired === op.params.replicas && after.actual === op.params.replicas;
  return { done, reason: done ? '资源已就绪' : after.reason || `等待副本就绪：${after.readyReplicas ?? 0}/${after.desired ?? 0}`, after };
}
