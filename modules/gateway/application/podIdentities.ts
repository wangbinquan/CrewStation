import type { WorkloadIdentity } from '@crewstation/contracts';
import type { ObservedPodObject } from '../api/moduleApi';
import type { PodLabels } from '../domain/podIdentity';
import { identityFromLabels, TOMBSTONE_RETENTION_MS, toWorkloadIdentity } from '../domain/podIdentity';
import type { GatewayUseCaseDeps } from './dependencies';

export interface ObservedPod {
  name: string;
  namespace: string;
  ip?: string;
  labels: PodLabels;
  deleted: boolean;
  phase?: string;
}

/**
 * cluster-control 转交的 Pod → 身份索引的输入。删除中的 Pod 照旧在册（优雅退出期间它的 IP 仍是它的，要等对象消失才标删除）；
 * 已结束（Succeeded、Failed）或没有 IP 的由 syncPod 标删除。
 */
export function observedPodOf(pod: ObservedPodObject, gone: boolean): ObservedPod {
  const status = (pod.status ?? {}) as { podIP?: string; phase?: string };
  return {
    name: pod.metadata.name, namespace: pod.metadata.namespace ?? 'default', labels: (pod.metadata.labels ?? {}) as PodLabels, deleted: gone,
    ...(status.podIP ? { ip: status.podIP } : {}), ...(status.phase ? { phase: status.phase } : {}),
  };
}

/** Pod 身份索引：按 cluster-control 的观测增量维护，cs-auth 按源 IP 反查（G1）。 */
export function podIdentityUseCases(deps: GatewayUseCaseDeps) {
  const syncPod = async (pod: ObservedPod): Promise<void> => {
    const identity = identityFromLabels(pod.labels);
    if (!identity) return;
    if (identity.taskId && deps.normalizeTaskId) {
      const taskId = await deps.normalizeTaskId(identity.taskId);
      if (!taskId) return;
      identity.taskId = taskId;
    }
    const now = deps.clock.now();
    if (pod.deleted || !pod.ip || pod.phase === 'Succeeded' || pod.phase === 'Failed') {
      await deps.pods.markDeleted(pod.name, pod.namespace, now);
      return;
    }
    await deps.pods.upsert({ ip: pod.ip, podName: pod.name, namespace: pod.namespace, ...identity, updatedAt: now });
  };
  return {
    syncPod,
    /**
     * 全量重列（启动与断线重连后）：逐个同步，再把这次没刷新到的在册行标为删除。watch 断开期间被删的 Pod 收不到
     * DELETED 事件，行一直「在册」，IP 被新 Pod 复用时按更新时间取最新的一行，可能取到死去的平台 Pod，把业务 Pod 认成平台
     *（2026-09-23 本机：52 个 Pod、144 条在册行）。以重列开始的时刻为界，之后才写进来的行（别的副本的 watch）不动。
     */
    relistPods: async (pods: readonly ObservedPod[]): Promise<number> => {
      const listedAt = deps.clock.now();
      for (const pod of pods) await syncPod(pod);
      const pruned = await deps.pods.pruneStale(listedAt, deps.clock.now());
      if (pruned > 0) deps.logger.info('pod identities pruned after relist', { pruned });
      return pruned;
    },
    lookupByIp: async (ip: string): Promise<WorkloadIdentity | undefined> => {
      const record = await deps.pods.byIp(ip);
      if (!record || record.deletedAt) return undefined;
      let prodPhysical: string | undefined;
      if (record.workload === 'service' && record.physicalSlot) {
        const svc = (await deps.services.listServices()).find((s) => s.identity === `${record.project}/${record.service}`);
        prodPhysical = svc ? (await deps.slots.slotRoles(svc.serviceId))?.prod : undefined;
      }
      return toWorkloadIdentity(record, prodPhysical);
    },
    listPodIdentities: () => deps.pods.listActive(),
    /** 墓碑清理（RFC-025 提案 Q5）：标为删除超过 7 天的行删掉；返回条数。 */
    purgeTombstones: () => deps.pods.purgeTombstones(new Date(deps.clock.now().getTime() - TOMBSTONE_RETENTION_MS)),
  };
}
