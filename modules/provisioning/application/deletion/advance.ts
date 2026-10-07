import { PROJECT_DELETION_PHASES, ProjectDeletionStepResultSchema } from '@crewstation/contracts';
import type { ProjectDeletionBlocker, ProjectDeletionOwner, ProjectDeletionPhase } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { ProjectDeletionIntents, ProjectDeletionStopOwner } from '../../ports/projectDeletions';
import { missingStopDependencies } from './stopDependencies';
import { withDeletionOwnerLease } from './ownerLease';

/** 元数据阶段先清子 owner，project 的服务／成员事实保留到最后。 */
function orderedOwners(owners: readonly ProjectDeletionStopOwner[], phase: ProjectDeletionPhase) {
  const last = phase === 'metadata' ? ['task-runtime', 'resources', 'project'] : phase === 'stop' ? ['task-runtime', 'observability', 'session', 'resources', 'cluster-control'] : phase === 'namespace' ? ['resources', 'provisioning', 'cluster-control'] : [];
  const rank = (name: string) => { const i = last.indexOf(name); return i < 0 ? 0 : i + 1; };
  return [...owners].sort((a, b) => rank(a.participant) - rank(b.participant));
}
export async function advanceProjectDeletion(intents: ProjectDeletionIntents, owners: readonly ProjectDeletionStopOwner[], id: string, worker: string, heartbeat?: () => Promise<boolean>) {
  const claimed = await intents.claim(id, worker, 600);
  if (!claimed) return;
  const { lease, plan } = claimed; let operation = claimed.operation, currentOwner: ProjectDeletionOwner | undefined;
  try {
    for (const phase of PROJECT_DELETION_PHASES) {
      let waiting: { participant: ProjectDeletionOwner['participant']; reason: string } | undefined;
      const blockers: ProjectDeletionBlocker[] = [];
      for (const owner of orderedOwners(owners, phase)) {
      currentOwner = owner;
      if (operation.receipts.some((r) => r.participant === owner.participant && r.phase === phase)) continue;
      if (heartbeat && !(await heartbeat())) throw precondition('项目删除队列租约已失效');
      await intents.renew(lease, 600);
      const context = { operationId: id, generation: lease.generation, target: plan.target, phase, confirmed: plan.participants.find((p) => p.participant === owner.participant)! };
      const missing = phase === 'stop' ? missingStopDependencies(owner.participant, operation.receipts) : [];
      if (missing.length) {
        if (owner.participant === 'resources') await owner.observeTerminating?.(context);
        waiting ??= { participant: owner.participant, reason: `等待 ${missing.join('、')} 的停止与收尾证明` }; continue;
      }
      const result = ProjectDeletionStepResultSchema.parse(await withDeletionOwnerLease(async () => {
        if (heartbeat && !(await heartbeat())) throw precondition('项目删除队列租约已失效');
        await intents.renew(lease, 600);
      }, () => owner.run(context)));
      if (result.kind === 'waiting') {
        if (phase !== 'stop' && phase !== 'seal') { await intents.defer(lease, owner.participant, result.reason); return; }
        // Close every source before waiting; stopping still requires each original dependency's receipt.
        waiting ??= { participant: owner.participant, reason: result.reason }; continue;
      }
      if (result.kind === 'blocked') {
        if (result.blockers.some((b) => b.participant !== owner.participant)) throw precondition('清理阻塞来源身份不符');
        if (phase === 'seal') { blockers.push(...result.blockers); continue; }
        await intents.block(lease, result.blockers); return;
      }
      operation = await intents.receipt(lease, owner.participant, phase, result.evidence);
      }
      if (blockers.length) { await intents.block(lease, blockers); return; }
      if (waiting) { await intents.defer(lease, waiting.participant, waiting.reason); return; }
    }
    await intents.complete(lease);
  } catch {
    if (currentOwner) await intents.block(lease, [{ participant: currentOwner.participant, code: 'owner-failed', message: `${currentOwner.participant} 暂无法继续清理；已完成项保留，可恢复来源后继续原操作` }]).catch(() => undefined);
    throw precondition('项目清理暂无法继续；已完成证明保留，请查看原操作的阻塞来源');
  }
}
