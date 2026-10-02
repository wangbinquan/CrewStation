import { DevelopmentParentEndingProjectionSchema } from '@crewstation/contracts';
import type { DevelopmentParentEndingProjection } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import { readDevelopmentParentEnding } from './parentEnding';
import type { projectEnvironment } from '../ledgerProjection';
import type { TaskEnvironment } from '../taskEnvironment';
import type { DevelopmentParentEpoch, DevelopmentParentEndingPointer } from './parentEnding';

type OriginalEndingProjection = { readonly id: string; readonly parentId: string; readonly projectId: string; readonly epochHash: string;
  readonly phase: DevelopmentParentEndingPointer['phase']; readonly epoch: DevelopmentParentEpoch; readonly membershipFrozen: boolean;
  readonly progress: Readonly<Record<string, unknown>> };

/** Pure projection from the original stored owner record, not a summary of live child pages or a fabricated proof. */
export function developmentParentProjection(environment: TaskEnvironment, ending: OriginalEndingProjection): DevelopmentParentEndingProjection {
  const pointer = readDevelopmentParentEnding(environment);
  if (!pointer || pointer.endingId !== ending.id || pointer.epochHash !== ending.epochHash || pointer.phase !== ending.phase
    || ending.parentId !== environment.id || ending.projectId !== environment.projectId || !ending.membershipFrozen)
    throw precondition('原父封存与台账投影身份不一致', { code: 'development_parent_ending_invalid' });
  const base = { version: 1, endingId: ending.id, epochHash: ending.epochHash, phase: ending.phase,
    originalRenderStart: ending.epoch.originalRenderStart, podName: ending.epoch.podName };
  return DevelopmentParentEndingProjectionSchema.parse(ending.phase === 'admission-sealed' || ending.phase === 'children'
    ? base : { ...base, ...ending.progress['prepared'] as Record<string, unknown> });
}

/** The same pure source projection is used by the actual Task transaction and maintenance snapshot check. */
export function sealedDevelopmentParentProjection(projection: ReturnType<typeof projectEnvironment>, environment: TaskEnvironment, ending: OriginalEndingProjection) {
  const seal = developmentParentProjection(environment, ending);
  return { ...projection, workload: { ...projection.workload,
    render: { ...projection.workload.render, developmentParentEnding: seal, ...('consumer' in seal ? { workloadConsumerId: seal.consumer.id } : {}) },
    conditions: [...projection.workload.conditions.filter((condition) => !['Provisioning', 'ReleasePending'].includes(condition.type)),
      { type: 'Provisioning', status: 'false' as const }, { type: 'DevelopmentAdmissionSealed', status: 'true' as const },
      { type: 'ReleasePending', status: ['stop-intent', 'proved'].includes(ending.phase) ? 'true' as const : 'false' as const }] } };
}
