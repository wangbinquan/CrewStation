import type { DevelopmentUsageInfo, TaskId } from '@crewstation/contracts';
import { DevelopmentUsageInfoSchema, StoredDevelopmentUsageSchema } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import type { DevelopmentDispatchDecision, DevelopmentDispatchDeps, DevelopmentDispatchResult } from '../../ports/developmentDispatch';
import type { DevelopmentUsageOwnerRecord } from '../../ports/developmentUsage';
import { developmentCapabilitiesSupported, developmentDispatchCommand, developmentInfoDecision, developmentReceiptDecision } from '../../domain/developmentDispatch';

async function originalInfo(deps: DevelopmentDispatchDeps, id: TaskId, original?: DevelopmentUsageOwnerRecord): Promise<DevelopmentUsageInfo | undefined> {
  try {
    const raw = await deps.session.sendCommand(id, { id: 'development-info-' + id, type: 'developmentUsageInfo', ...(original?.binding ? { key: original.binding.key } : {}) });
    const parsed = DevelopmentUsageInfoSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}
async function bindOriginal(deps: DevelopmentDispatchDeps, original: DevelopmentUsageOwnerRecord): Promise<DevelopmentUsageOwnerRecord | DevelopmentDispatchResult> {
  const id = original.intent.identity.executionId as TaskId, status = await deps.session.connectionStatus(id);
  if (!status.connected) return { kind: 'waiting', reason: 'disconnected' };
  if (!status.capabilities) return { kind: 'waiting', reason: 'unknown-capabilities' };
  if (!developmentCapabilitiesSupported(original, status.capabilities)) {
    if (status.capabilities.developmentStartAgentFenceV1 === 1) {
      await deps.owner.observeSupported(id); // Persist the selected-layout fence before any legacy decision.
      return { kind: 'waiting', reason: 'source-unavailable' };
    }
    if (original.capabilityPodUid) return { kind: 'waiting', reason: 'source-unavailable' };
    const next = await deps.owner.unsupported(id);
    return next.closeReason ? { kind: 'ending', reason: next.closeReason } : { kind: 'legacy', reason: 'unsupported' };
  }
  await deps.owner.observeSupported(id); // PG CAS BEFORE info: a reconnect cannot erase advertised support.
  const info = await originalInfo(deps, id);
  if (!info) return { kind: 'waiting', reason: 'source-unavailable' };
  if (info.receipt || info.runtimeTaskId !== id) return { kind: 'waiting', reason: 'source-conflict' };
  return deps.owner.bind(id, info); // Verifies independently persisted actual child Pod UID before binding CAS.
}
async function recoverOriginal(deps: DevelopmentDispatchDeps, original: DevelopmentUsageOwnerRecord): Promise<DevelopmentDispatchDecision | { kind: 'ending'; reason: NonNullable<DevelopmentUsageOwnerRecord['closeReason']> }> {
  const binding = original.binding!;
  // Idempotent registration must succeed before digital start/stop/info with this key.
  const parsed = StoredDevelopmentUsageSchema.safeParse(await deps.session.registerDevelopmentUsage(binding));
  if (!parsed.success || jsonHash(parsed.data.registration) !== jsonHash(binding)) return { kind: 'waiting', reason: 'session-conflict' };
  const stored = parsed.data;
  if (stored.receipt?.phase === 'finished') return developmentReceiptDecision(binding, stored.receipt);
  if (stored.drainReason) return { kind: 'ending', reason: stored.drainReason };
  if (stored.loss || stored.closure) return { kind: 'waiting', reason: 'source-unavailable' };
  const info = await originalInfo(deps, binding.runtimeTaskId, original);
  if (!info) return { kind: 'waiting', reason: 'source-unavailable' };
  const decision = developmentInfoDecision(binding, info);
  if (decision.kind === 'empty' && stored.receipt) return { kind: 'waiting', reason: 'receipt-regressed' };
  return decision;
}
async function dispatchPrepared(deps: DevelopmentDispatchDeps, executionTaskId: TaskId): Promise<DevelopmentDispatchResult> {
  let original = await deps.owner.get(executionTaskId);
  if (!original) return { kind: 'legacy', reason: 'unselected' };
  if (original.closeReason) return { kind: 'ending', reason: original.closeReason };
  if (original.unsupported) return { kind: 'legacy', reason: 'unsupported' };
  if (!original.binding) {
    const bound = await bindOriginal(deps, original);
    if ('kind' in bound) return bound;
    original = bound;
    if (original.closeReason) return { kind: 'ending', reason: original.closeReason };
  }
  const before = await recoverOriginal(deps, original);
  if (before.kind !== 'empty') return before;
  const command = developmentDispatchCommand(original, await deps.material(original));
  if (!command) return { kind: 'waiting', reason: 'command-conflict' };
  // Material acquisition can race cancellation, Session drain or a delayed original acceptance.
  const current = await deps.owner.get(executionTaskId);
  if (current?.closeReason) return { kind: 'ending', reason: current.closeReason };
  if (!current || current.unsupported || jsonHash(current) !== jsonHash(original)) return { kind: 'waiting', reason: 'admission-changed' };
  const afterMaterial = await recoverOriginal(deps, current);
  if (afterMaterial.kind !== 'empty') return afterMaterial;
  try { await deps.session.sendCommand(executionTaskId, command); }
  catch { /* Lost ACK does not prove rejection: restore only the SAME key. */ }
  const afterStart = await recoverOriginal(deps, current);
  return afterStart.kind === 'empty' ? { kind: 'waiting', reason: 'awaiting-receipt' } : afterStart;
}
/** Internal participant. Accepted/terminal results need durable owner state and an ending job; this grants no cleanup permission. */
export async function dispatchDevelopmentAgent(deps: DevelopmentDispatchDeps, executionTaskId: TaskId): Promise<DevelopmentDispatchResult> {
  try { return await dispatchPrepared(deps, executionTaskId); }
  catch { return { kind: 'waiting', reason: 'retry' }; }
}
