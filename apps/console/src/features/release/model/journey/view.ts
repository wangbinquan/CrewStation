import type { ReleaseJourneyDetail, ReleaseJourneyStageDto } from '@crewstation/contracts';
import type { Progress } from '../../../../shared/ui/progress/stageProgressView';

export const JOURNEY_GROUPS = [
  ['prepare'], ['queued', 'build', 'migration', 'deploy', 'ready'], ['verification'], ['launch', 'freeze', 'handoff-prepare', 'route', 'activate'], ['complete'],
] as const;
export const journeyEnded = (status: string) => ['succeeded', 'failed', 'interrupted'].includes(status);
export function journeyStep(detail: ReleaseJourneyDetail): number {
  if (detail.status === 'succeeded') return 4;
  if (detail.trafficSwitch || detail.status === 'awaiting-confirmation') return 3;
  if (detail.status === 'awaiting-verification' || detail.stages.some(stage => stage.stage === 'ready' && stage.state === 'succeeded')) return 2;
  return 1;
}
export function stageProgress(stages: readonly ReleaseJourneyStageDto[], step: number, status: string): Progress {
  const selected = stages.filter(stage => (JOURNEY_GROUPS[step] as readonly string[]).includes(stage.stage));
  return { state: status === 'failed' ? 'failed' : status === 'interrupted' ? 'cancelled' : selected.some(stage => stage.state === 'running') ? 'running' : 'ready',
    stages: selected.map(stage => ({ kind: stage.stage, state: stage.state, startedAt: stage.startedAt, endedAt: stage.finishedAt, durationMs: stage.durationMs, detail: stage.reason })) };
}
