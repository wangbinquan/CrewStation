import { WorkloadConsumerSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { DevelopmentRemovalDecision, DevelopmentRemovalTarget } from '../../api/developmentCleanup';
import { requireDevelopmentRemovalEvidence } from '../../domain/development/removalEvidence';
import { developmentWorkloadProtection } from '../../domain/development/protection';
import type { NativeExecutionCluster } from '../../ports/cluster';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';
import { developmentAdmissionSecretUid, developmentPhysicalStop } from './workloadStop';

type Deps = TaskRuntimeUseCaseDeps & { nativeCluster: NativeExecutionCluster };
const waiting = (): DevelopmentRemovalDecision => ({ kind: 'waiting', reason: 'development-removal-evidence-pending' });
function physicalPodName(target: DevelopmentRemovalTarget): string | undefined {
  if (target.kind === 'Pod') return target.name;
  const suffix = ['-runner', '-admission'].find((value) => target.name.endsWith(value));
  return suffix ? target.name.slice(0, -suffix.length) : undefined;
}
/** Read only original Task/Resources facts. No directory scan, digital advance or lifecycle mutation. */
export function developmentRemovalLookup(deps: Deps) {
  return async (target: DevelopmentRemovalTarget): Promise<DevelopmentRemovalDecision> => {
    try {
      if (!target.namespace || !target.name || !target.uid || !['Pod', 'Secret'].includes(target.kind)
        || !['delete', 'stop-finalizer'].includes(target.operation) || target.kind !== 'Pod' && target.operation !== 'delete') return waiting();
      const podName = physicalPodName(target);
      if (!podName) return { kind: 'unselected' };
      const matches = await deps.uow.read.environments.findByPhysicalPod(target.namespace, podName);
      if (!matches.length) return { kind: 'unselected' };
      if (matches.length !== 1) return waiting();
      const env = matches[0]!;
      // Presence, never truthiness: malformed explicit selections cannot fall back to legacy.
      if (env.render?.developmentRemovalProtection === undefined) return { kind: 'unselected' };
      const { original } = requireDevelopmentRemovalEvidence(env), protection = developmentWorkloadProtection(original)!;
      const safety = deps.workloadSafety, state = await safety?.get(protection.consumer.id);
      if (!safety || !state?.admissionClosed || !await safety.admissionClosed(protection.consumer.id)) throw precondition('原开发准入尚未关闭');
      const consumer = WorkloadConsumerSchema.parse({ ...protection.consumer, resourceId: original.id,
        namespace: original.namespace, podName: original.podName, volumeUid: protection.expectedVolumeUid });
      if (jsonHash(WorkloadConsumerSchema.parse(state.consumer)) !== jsonHash(consumer)) throw precondition('原开发消费者身份不符');
      await developmentAdmissionSecretUid(safety, original);
      const stopped = target.kind === 'Secret' || target.operation === 'stop-finalizer' ? await developmentPhysicalStop(safety, original) : undefined;
      if (!deps.nativeCluster.inspectDevelopmentRemoval) return waiting();
      return await deps.nativeCluster.inspectDevelopmentRemoval(original, target, stopped);
    } catch {
      // A read/validation failure never means absent, unselected or irretrievable evidence.
      return waiting();
    }
  };
}
