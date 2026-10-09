import type { ReleaseJourneyEvent, ReleaseJourneyStageDto } from '@crewstation/contracts';
import { ReleaseJourneyStageSchema } from '@crewstation/contracts';
import type { Release } from '../release';

/** Missing history stays unknown. Only a recorded running/end pair earns a duration. */
export function journeyStages(events: readonly ReleaseJourneyEvent[], legacy = false): ReleaseJourneyStageDto[] {
  return ReleaseJourneyStageSchema.options.map((stage) => {
    const facts = events.filter((event) => event.stage === stage), last = facts.at(-1);
    if (!last) return { stage, state: legacy ? 'unknown' : 'pending' };
    const startedAt = facts.find((event) => event.state === 'running')?.at;
    const finishedAt = ['succeeded', 'failed', 'skipped'].includes(last.state) ? last.at : undefined;
    const elapsed = startedAt && finishedAt ? Date.parse(finishedAt) - Date.parse(startedAt) : undefined;
    return { stage, state: last.state, ...(startedAt ? { startedAt } : {}), ...(finishedAt ? { finishedAt } : {}),
      ...(elapsed !== undefined && elapsed >= 0 ? { durationMs: elapsed } : {}), ...(last.reason ? { reason: last.reason } : {}) };
  });
}

export function legacyJourneyStages(release: Release): ReleaseJourneyStageDto[] {
  const starts = { build: release.pipeline.buildStartedAt, migration: release.pipeline.migrationStartedAt, deploy: release.pipeline.deployStartedAt };
  return ReleaseJourneyStageSchema.options.map((stage) => {
    const startedAt = stage === 'build' || stage === 'migration' || stage === 'deploy' ? starts[stage] : undefined;
    const ready = stage === 'ready' ? release.pipeline.readyAt : undefined;
    return { stage, state: ready ? 'succeeded' : 'unknown', ...(startedAt ? { startedAt } : {}), ...(ready ? { finishedAt: ready } : {}) };
  });
}
