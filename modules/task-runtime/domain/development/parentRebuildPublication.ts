import { jsonHash, precondition } from '@crewstation/kernel';
import { originalParentCompletion } from './parentCompletion';
import { DevelopmentParentRebuildBindingSchema, DevelopmentParentRebuildSelectionSchema } from './parentRebuildBinding';
import { rebuildIntent } from '../physicalIdentity';
import type { EnvironmentRebuild } from '../environmentRebuild';
import type { TaskEnvironment } from '../taskEnvironment';
import type { DevelopmentParentEpoch, DevelopmentParentEndingPointer } from './parentEnding';

type PublishedParentRebuildSource = { readonly id: string; readonly parentId: string; readonly projectId: string; readonly epochHash: string;
  readonly phase: DevelopmentParentEndingPointer['phase']; readonly epoch: Pick<DevelopmentParentEpoch, 'pvcUid' | 'originalRenderStart'>;
  readonly intent: Readonly<Record<string, unknown>>; readonly completionWitness: unknown };

/** Old proof selects only the source. A published new epoch is bound to its own immutable request and actual Pod identity. */
export function requirePublishedParentRebuild(environment: TaskEnvironment, record: EnvironmentRebuild, ending: PublishedParentRebuildSource): void {
  const binding = DevelopmentParentRebuildBindingSchema.parse(record.developmentParentBinding), witness = originalParentCompletion(ending.completionWitness, ending);
  if (ending.phase !== 'complete' || ending.parentId !== record.taskId || ending.projectId !== record.projectId || binding.endingId !== ending.id || binding.epochHash !== ending.epochHash
    || Object.hasOwn(environment, 'parentEnding') || environment.native || environment.kind !== 'dev-session' || environment.id !== record.taskId
    || environment.projectId !== record.projectId || environment.namespace !== record.namespace || environment.podName !== record.podName
    || environment.pvcName !== record.pvcName || environment.rebuildId !== record.id || environment.profile !== record.input.profile.id
    || record.input.expectedVolumeUid !== ending.epoch.pvcUid || record.podUid && environment.podUid !== record.podUid) throw precondition('新恢复 epoch 与原发布请求不一致');
  if (binding.kind === 'pending-ending' && (witness.outcome !== 'rebuild-published' || ending.intent['rebuildId'] !== record.id)
    || binding.kind === 'completed-ending' && (witness.outcome !== 'compensation' || binding.completionWitnessHash !== jsonHash(witness)
      || binding.afterTransitionHash !== witness.afterTransitionHash || binding.pvcUid !== ending.epoch.pvcUid)) throw precondition('新恢复请求不能采用另一项原完成退出');
  if (record.creation === 'ledger') {
    const render = environment.render, selected = DevelopmentParentRebuildSelectionSchema.parse(render?.rebuild?.developmentParentSelection);
    if (!render || render.rebuild?.id !== record.id || render.rebuild.volumeUid !== ending.epoch.pvcUid || render.rebuild.intent !== rebuildIntent(record)
      || render.start !== (ending.epoch.originalRenderStart ?? 0) + 1 || render.image !== record.image || selected.requestId !== record.id
      || selected.sourceEndingId !== ending.id || selected.sourceEpochHash !== ending.epochHash) throw precondition('新恢复 render 原发布材料已变化');
  } else if (Object.hasOwn(environment, 'render')) throw precondition('原 owner 恢复不能凭空补写 ledger render');
}
