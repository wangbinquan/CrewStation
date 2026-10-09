import type { ExecutionHandoffOperation } from '../../domain/executionHandoff';
import { journeyTerminal } from '../../domain/journey/journey';
import type { RepositoryScope } from '../../ports/unitOfWork';

/** Handoff facts are appended only when its own compare-and-set succeeded. */
export async function recordHandoffStage(scope: RepositoryScope, before: ExecutionHandoffOperation, next: ExecutionHandoffOperation['stage'], now: Date, routeObserved = false): Promise<void> {
  if (!before.journeyId) return;
  const journey = await scope.journeys.get(before.journeyId);
  if (!journey || journeyTerminal(journey)) return;
  const at = now.toISOString(), journeyId = journey.id;
  const append = (stage: 'freeze' | 'handoff-prepare' | 'route' | 'activate', state: 'running' | 'succeeded', key = `${stage}:${state}`) =>
    scope.journeys.append(journeyId, { transitionKey: key, stage, state, at, handoffId: before.id });
  if (before.stage === 'freezing' && next === 'preparing') {
    await append('freeze', 'succeeded'); await append('handoff-prepare', 'running');
  }
  if (before.stage === 'preparing' && next === 'routing') {
    await append('handoff-prepare', 'succeeded', `handoff-prepare:${before.revision}:succeeded`); await append('route', 'running');
  }
  if (before.stage === 'routing' && next === 'preparing') await append('handoff-prepare', 'running', `handoff-prepare:${before.revision}:running`);
  if (routeObserved) { await append('route', 'succeeded'); await append('activate', 'running'); }
  if (next === 'complete') await append('activate', 'succeeded');
}
