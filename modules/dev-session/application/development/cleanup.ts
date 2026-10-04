import { TaskIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { DevelopmentCleanupSelectionSchema, developmentCleanupEvidence } from '../../domain/development/cleanup';
import type { DevelopmentCleanupSelection } from '../../domain/development/cleanup';
import type { DevelopmentCleanupDeps, DevelopmentCleanupParticipant } from '../../ports/developmentCleanup';
import { requestDevelopmentEnding, advanceDevelopmentEnding } from './ending';

async function inspectOriginal(deps: DevelopmentCleanupDeps, selection: DevelopmentCleanupSelection) {
  const id = TaskIdSchema.parse(selection.identity.executionId), owner = await deps.owner.get(id);
  if (!owner?.binding || owner.unsupported) return undefined;
  const env = await deps.environments.getEnvironment(id), n = env?.native, i = owner.intent;
  if (jsonHash(i.identity) !== jsonHash(selection.identity) || i.profileId !== selection.profileId || i.profileRevision !== selection.profileRevision
    || owner.binding.podUid !== selection.podUid || owner.binding.runtimeTaskId !== id || !env || env.id !== id || env.projectId !== i.identity.projectId
    || env.state !== 'releasing' || n?.purpose !== 'agent' || n.state !== 'cleaning' || n.parentTaskId !== i.identity.taskId
    || n.agentId !== i.identity.agentId || n.podUid !== selection.podUid || n.terminalId !== undefined) throw precondition('原开发 owner、Agent 与实际清理环境不匹配');
  return owner;
}
/** No timers, legacy fallback or physical I/O. Each replay rechecks the actual original PG copy. */
export function developmentCleanupParticipant(deps: DevelopmentCleanupDeps): DevelopmentCleanupParticipant {
  return { advance: async (raw) => {
    const selection = DevelopmentCleanupSelectionSchema.parse(raw), id = TaskIdSchema.parse(selection.identity.executionId);
    const original = await inspectOriginal(deps, selection);
    if (!original) return { kind: 'waiting', reason: 'unbound' };
    await deps.closeOriginalAdmission?.(id);
    await requestDevelopmentEnding(deps, id, original.closeReason ?? 'cancelled');
    await advanceDevelopmentEnding(deps, id);
    const owner = await inspectOriginal(deps, selection), job = await deps.store.get(id);
    if (!owner?.binding || job?.stage !== 'evidence-complete') return { kind: 'waiting', reason: 'digital-ending' };
    const stored = await deps.session.getDevelopmentUsage(id, owner.binding.key);
    if (!stored?.closure) return { kind: 'waiting', reason: 'durable-copy' };
    return { kind: 'permitted', evidence: developmentCleanupEvidence(selection, owner, job, stored) };
  } };
}
