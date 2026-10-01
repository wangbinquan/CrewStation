import { jsonHash, precondition } from '@crewstation/kernel';
import { developmentWorkloadProtection } from './protection';
import { DevelopmentCleanupSelectionSchema } from './cleanupEvidence';
import type { DevelopmentCleanupSelection } from './cleanupEvidence';
import type { TaskEnvironment } from '../taskEnvironment';

/** Only the immutable admitted identity participates; activity, state and cleanup retries do not. */
export function developmentCleanupSelection(env: TaskEnvironment): DevelopmentCleanupSelection | undefined {
  if (env.render?.developmentUsageProtection === undefined) return undefined;
  const protection = developmentWorkloadProtection(env), n = env.native!, render = env.render!;
  if (!protection || n.state !== 'cleaning' || env.state !== 'releasing') return undefined;
  if (!n.podUid || !n.secretUid || env.podUid && env.podUid !== n.podUid) throw precondition('原开发执行尚无完整 Pod 与 Runner Secret 绑定');
  const { runtimeConnectionDeadline: _connection, runtimeInitializationDeadline: _initialization, ...acceptedRender } = render;
  const selectionHash = jsonHash({ id: env.id, projectId: env.projectId, serviceId: env.serviceId, kind: env.kind, volumeMode: env.volumeMode,
    profile: env.profile, namespace: env.namespace, podName: env.podName, pvcName: env.pvcName, traceId: env.traceId, createdBy: env.createdBy ?? null,
    labels: env.labels, runnerTokenHash: env.runnerTokenHash, render: acceptedRender,
    native: { purpose: n.purpose, parentTaskId: n.parentTaskId, parentPodUid: n.parentPodUid, pvcUid: n.pvcUid, nodeName: n.nodeName,
      agentId: n.agentId, runnerId: n.runnerId, fingerprint: n.fingerprint, requestedProfile: n.requestedProfile, profile: n.profile,
      image: n.image, computeProfile: n.computeProfile, podUid: n.podUid, secretUid: n.secretUid } });
  return DevelopmentCleanupSelectionSchema.parse({ version: 1, identity: { sourceKind: 'development-agent', projectId: env.projectId,
    taskId: n.parentTaskId, agentId: n.agentId, executionId: env.id, executionGeneration: 1 }, profileId: n.computeProfile!.profileId,
    profileRevision: n.computeProfile!.revision, podUid: n.podUid, consumerId: protection.consumer.id, renderStart: render.start, selectionHash });
}
