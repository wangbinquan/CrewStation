import type { Actor, ClusterInspectRequest, ClusterInspection, ClusterOperation, ClusterResource, ProfileTestId, RebuildDevSessionRequest, TaskId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { ClusterActionPorts } from '../../ports/clusterActions';

export function clusterOperationPorts(p: ClusterActionPorts) {
  const { tasks, dev, business, release } = p;
  const inspectTask = async (actor: Actor, target: ClusterResource, request: ClusterInspectRequest): Promise<Record<string, unknown>> => {
    if (target.purpose === 'development-cli') return dev.inspectClusterNative(actor, target.taskId as TaskId);
    if (target.purpose === 'development-agent') return dev.inspectClusterAgent(actor, target.taskId as TaskId);
    if (target.purpose === 'business-subtask' || target.purpose === 'business-workspace') return business.inspectClusterTask(actor, target, request);
    if (target.purpose === 'profile-test') { if (request.action !== 'delete') throw precondition('档位测试只能停止，请从算力档位页面重新测试'); if (!target.facts.profileTestId) throw precondition('任务记录缺少档位测试关联，请从算力档位页面核对'); return { testId: target.facts.profileTestId }; }
    const env = await tasks.getEnvironment(target.taskId as TaskId); if (!env) throw precondition('开发环境不存在');
    const { checkedAt: _checkedAt, ...workspace } = await dev.workspaceStatus(actor, env.projectId);
    if (request.action === 'delete') return { taskId: env.id, volumeMode: env.volumeMode, workspace };
    const inspection = await tasks.inspectRebuild(env.projectId, true), profile = inspection.profiles.find((entry) => entry.id === inspection.currentProfile);
    if (!profile) throw precondition('原任务套餐已不存在');
    return { taskId: env.id, workspace, rebuild: { expectedTaskId: env.id, expectedUpdatedAt: inspection.updatedAt, expectedPodUid: inspection.podUid, expectedVolumeUid: inspection.volume.uid, profile: { id: profile.id, name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage }, reason: inspection.reason } };
  };
  const executeTask = async (actor: Actor, op: ClusterOperation, inspection: ClusterInspection) => {
    if (op.target.purpose === 'development-cli') return dev.manageClusterNative(actor, op.target.taskId as TaskId, op.action === 'restart', op.operationId);
    if (op.target.purpose === 'development-agent') return dev.manageClusterAgent(actor, op.target.taskId as TaskId, op.action === 'restart', op.operationId);
    if (op.target.purpose === 'business-subtask' || op.target.purpose === 'business-workspace') return business.executeClusterTask(actor, op);
    if (op.target.purpose === 'profile-test') { await p.stopProfile(actor, inspection.domain?.testId as ProfileTestId); await tasks.releaseEnvironment(op.target.taskId as TaskId, 'profile-test'); return { operationId: op.target.taskId! }; }
    const env = await tasks.getEnvironment(op.target.taskId as TaskId); if (!env) throw precondition('开发环境不存在');
    if (op.action === 'delete') await dev.releaseSession(actor, env.projectId, { force: true, expectedTaskId: env.id });
    else await dev.rebuildSession(actor, env.projectId, { ...inspection.domain?.rebuild as Omit<RebuildDevSessionRequest, 'requestId'>, requestId: op.operationId });
    return { operationId: op.action === 'restart' ? op.operationId : env.id };
  };
  const observeTask = async (op: ClusterOperation) => {
    if (op.target.purpose === 'business-subtask' || op.target.purpose === 'business-workspace') return business.observeClusterTask(op);
    if (op.action === 'restart' && op.target.purpose === 'development-workspace') { const rebuild = await tasks.getRebuild(op.target.taskId as TaskId); return { done: rebuild?.state === 'ready' || rebuild?.state === 'failed', failed: rebuild?.state === 'failed', reason: rebuild?.message ?? '等待新工作区 Runner 连接' }; }
    const env = await tasks.getEnvironment((op.action === 'restart' ? op.domainOperationId : op.target.taskId) as TaskId);
    return { done: op.action === 'delete' ? !env || env.state === 'released' : env?.state === 'running' && env.connected || env?.state === 'failed', failed: op.action === 'restart' && env?.state === 'failed', reason: env?.message ?? (op.action === 'delete' ? '等待执行环境回收' : '等待新执行连接') };
  };
  return {
    inspect: async (actor: Actor, target: ClusterResource, request: ClusterInspectRequest) => {
      if (target.serviceId && target.kind === 'Deployment') return release.inspectSlotOperation(actor, target, request);
      const capability = target.availableActions.find((a) => a.action === request.action)!;
      try { const domain = await inspectTask(actor, target, request); return { capability: { ...capability, impactSummary: [...capability.impactSummary, ...(domain.volumeMode === 'follow-container' && request.action === 'delete' ? ['此工作区的工作卷也会释放，请先确认所有未提交及未推送内容'] : []), ...(target.purpose === 'development-workspace' && request.action === 'restart' ? ['保留原任务与工作卷；结束该工作区内所有 CLI 和 Agent，新工作区连接后需手动启动'] : [])] }, domain }; } catch (e) { return { capability: { ...capability, enabled: false, reason: e instanceof Error ? e.message : String(e) } }; }
    },
    execute: (actor: Actor, op: ClusterOperation, inspection: ClusterInspection) => op.target.kind === 'Deployment' ? release.executeSlotOperation(actor, op, inspection) : executeTask(actor, op, inspection),
    observe: (op: ClusterOperation) => op.target.kind === 'Deployment' ? release.observeSlotOperation(op) : observeTask(op),
  };
}
