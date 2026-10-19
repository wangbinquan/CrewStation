import type { ServiceId } from '@crewstation/contracts';
import { isPlatformError } from '@crewstation/kernel';
import type { DatabaseRestoreOperation } from '../../domain/databaseRestore';
import { restoreEnded } from '../../domain/databaseRestore';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { restoreContext } from './context';
import { freezeRestoreEnvironment, progressRestoreJob } from './jobs';
import { freezeForRestore, readyRestoreCandidate, switchRestoreCandidate } from './cutover';

/**
 * `native_postgres_source_busy`: the node's single-flight storage probe is serving another measurement. AW RFC-370
 * hosted acceptance (2026-10-19): an independent restore parked in `requested` on it and each administrator retry lost
 * the race again within seconds; project deletion already waits it out the same way. `restore_writers_running`: the
 * switch waits for the old release to stop its writers (CS RFC-027 stop authority), reported, not parked.
 */
const TRANSIENT_CODES = new Set(['restore_job_terminating', 'execution_control_busy', 'object_storage_busy', 'native_postgres_source_busy', 'restore_writers_running']);
/**
 * Platform rejections (identity drift, revoked confirmation, failed probes) wait for an administrator to retry or abandon;
 * infrastructure failures are only recorded and observed again automatically, so they never park the operation (RFC-042).
 */
export function restoreFailureBlocks(error: unknown): boolean {
  if (!isPlatformError(error) || TRANSIENT_CODES.has(String(error.details['code'] ?? ''))) return false;
  return ['conflict', 'precondition', 'forbidden', 'validation', 'not_found'].includes(error.kind);
}
async function stepRestore(deps: ReleaseUseCaseDeps, op: DatabaseRestoreOperation) {
  const c = restoreContext(deps);
  if (op.stage === 'requested') { await c.database.reserve({ id: op.targetGenerationId, operationId: op.id, serviceId: op.serviceId, expectedGenerationId: op.sourceGenerationId, expectedRevision: op.sourceBindingRevision }); await c.save(op, { stage: 'provisioning' }); }
  else if (op.stage === 'provisioning') { const target = await c.database.prepare(op.serviceId, op.id, op.targetGenerationId); if (target.ready) { const frozen = await freezeRestoreEnvironment(deps, op); await c.save(frozen, { stage: 'restoring' }); } }
  else if (op.stage === 'restoring' || op.stage === 'verifying') await progressRestoreJob(deps, op, op.stage === 'restoring' ? 'database-restore' : 'database-verify');
  else if (op.stage === 'freezing') await freezeForRestore(deps, op);
  else if (op.stage === 'deploying') await readyRestoreCandidate(deps, op);
  else if (op.stage === 'switching') await switchRestoreCandidate(deps, op);
}
async function observeOutcome(deps: ReleaseUseCaseDeps, serviceId: ServiceId, id: string, error?: unknown) {
  const c = restoreContext(deps), current = await c.load(serviceId, id), now = deps.clock.now();
  if (restoreEnded(current) || current.error || current.abandonedAt) return;
  if (error === undefined) { if (current.observation) await c.save(current, { observation: null }); return; }
  const message = isPlatformError(error) ? error.message.slice(0, 1000) : '原恢复外部状态暂不可确认，平台会自动重新观察';
  if (restoreFailureBlocks(error)) { await c.save(current, { error: message, observation: null }); return; }
  // Throttled so a long outage does not churn the revision administrators confirm against.
  const prior = current.observation;
  if (!prior || prior.message !== message || now.getTime() - Date.parse(prior.at) >= 60_000) await c.save(current, { observation: { message, at: now.toISOString(), failures: (prior?.failures ?? 0) + 1 } });
}
export function databaseRestoreProgress(deps: ReleaseUseCaseDeps) {
  let afterId: string | undefined, inFlight: Promise<number> | undefined;
  const run = async () => {
    if (!deps.databaseRestore) return 0;
    const c = restoreContext(deps), page = await c.store.pending(20, afterId); afterId = page.length === 20 ? page.at(-1)!.id : undefined;
    let count = 0;
    for (const candidate of page) {
      try {
        await c.work(candidate.serviceId, candidate.id, { operationId: candidate.id }, async () => {
          const op = await c.load(candidate.serviceId, candidate.id);
          for (const [jobId, proof] of [[op.restoreJobId, op.restoreProof], [op.verifyJobId, op.verifyProof]] as const) if (proof && ['succeeded', 'failed'].includes(proof.receipt.state)) await deps.uow.run(scope => scope.ledger!.restoreJobObserved(jobId));
          if (op.error || restoreEnded(op) || op.stage === 'ready-to-switch' || op.abandonedAt) return;
          let failure: unknown;
          try { await stepRestore(deps, op); count++; } catch (error) { failure = error ?? new Error('unknown'); }
          await observeOutcome(deps, op.serviceId, op.id, failure);
        });
      } catch (error) { deps.logger.warn('database restore admission unavailable', { operationId: candidate.id, error: isPlatformError(error) ? error.kind : 'unavailable' }); }
    }
    return count;
  };
  return () => { inFlight ??= run().finally(() => { inFlight = undefined; }); return inFlight; };
}
