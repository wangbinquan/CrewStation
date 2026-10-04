import type { ProjectDeletionContext } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { RuntimeStopHistory, RuntimeStopProject, RuntimeStopReceipts, RuntimeStoppedEnvironment } from '../../ports/runtimeStops';
import { runtimeHistoricalStop } from './runtimeStopHistory';

/** The Root supplies each owner's stored confirmation; no caller-made Pod identity can authorize cleanup. */
export function runtimeProjectStops<Selection, Result>(project: RuntimeStopProject,
  development: (context: ProjectDeletionContext, selection: Selection) => Promise<Result>, receipts: RuntimeStopReceipts,
  digital: (context: ProjectDeletionContext, environment: RuntimeStoppedEnvironment) => Promise<{ kind: 'ready' } | { kind: 'waiting'; reason: string }>, history?: RuntimeStopHistory) {
  return {
    development: (context: ProjectDeletionContext) => ({ advance: async (selection: Selection) => {
      const grant = await project.projectDeletionParticipantContext(context, 'dev-session');
      return development(grant, selection);
    } }),
    digital,
    stopped: async (context: ProjectDeletionContext, environment: RuntimeStoppedEnvironment) => {
      await project.assertProjectDeletionGrant(context);
      const grant = await project.projectDeletionParticipantContext(context, 'resources');
      const pods = grant.confirmed.resources.filter((row) => {
        if (row.kind !== 'protected:Pod' || row.scope === 'metadata') return false;
        const key = JSON.parse(row.id) as { kind?: string; namespace?: string; name?: string };
        return key.kind === 'Pod' && key.namespace === environment.namespace && key.name === environment.podName;
      });
      if (pods.length === 0) {
        const proof = history ? await runtimeHistoricalStop(history, environment) : undefined;
        await project.assertProjectDeletionGrant(context); return proof;
      }
      if (pods.length !== 1) throw precondition('原执行 Pod 的完整确认范围不唯一');
      const pod = pods[0]!, selected = JSON.parse(pod.identity) as { uid?: unknown; nodeUid?: unknown; nodeName?: unknown; specDigest?: unknown }, uid = selected.uid;
      if (typeof uid !== 'string' || !uid || pod.sourceIdentity !== undefined && pod.sourceIdentity !== uid
        || typeof selected.specDigest !== 'string' || !/^[a-f0-9]{64}$/.test(selected.specDigest)
        || selected.nodeUid !== null && typeof selected.nodeUid !== 'string' || selected.nodeName !== null && typeof selected.nodeName !== 'string'
        || !!selected.nodeUid !== !!selected.nodeName) throw precondition('原执行 Pod 的独立确认 UID 或节点无效');
      for (const expected of [environment.podUid, environment.native?.podUid])
        if (expected !== undefined && expected !== uid) throw precondition('原执行与确认 Pod 实例冲突');
      const proof = await receipts.get(grant, pod.id, uid);
      await project.assertProjectDeletionGrant(context);
      if (!proof) return undefined;
      if (proof.uid !== uid || proof.key !== pod.id || proof.nodeUid !== selected.nodeUid || !/^[a-f0-9]{64}$/.test(proof.digest)) throw precondition('原完整 Pod 停止回执与原实例或节点不符');
      return { digest: proof.digest };
    },
  };
}
