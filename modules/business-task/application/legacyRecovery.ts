import type { Actor, TaskId } from '@crewstation/contracts';
import { forbidden, jsonHash, notFound, precondition } from '@crewstation/kernel';
import type { LegacyRecoveryItem, LegacyRecoveryResult } from '../api/legacyRecovery';
import type { LegacyMutations, LegacyMutationRecord } from '../ports/legacyMutations';
import type { LegacyRecoveryProof } from '../ports/legacyRecovery';
import type { BusinessTaskUseCaseDeps } from './dependencies';

/** No TTL unlock. Recovery consumes positive stop proofs and retains a completed tombstone. */
export function legacyRecoveryUseCases(deps: Pick<BusinessTaskUseCaseDeps, 'directory' | 'environments' | 'projectWork'>, tickets: LegacyMutations, proof?: LegacyRecoveryProof) {
  const service = async (actor: Actor, identity: string) => {
    if (!actor.isAdmin) throw forbidden('旧执行票据恢复仅供平台管理员');
    const resolved = await deps.directory.resolveServiceIdentity(identity);
    if (!resolved) throw notFound('服务', identity);
    return resolved;
  };
  const inspect = async (ticket: LegacyMutationRecord, stopped = false): Promise<LegacyRecoveryItem> => {
    const blockedBy: string[] = [];
    const request = ticket.kind.endsWith('-request');
    if (ticket.state === 'open' || request) {
      if (!ticket.ownerPodUid) blockedBy.push('owner_identity_missing');
      else if (!proof || !await proof.ownerGone(ticket.ownerPodUid)) blockedBy.push('owner_process_not_stopped');
    }
    if (!await tickets.childrenComplete(ticket.id)) blockedBy.push('child_effects_unconfirmed');
    let canStopRuntime = false;
    if (!request) {
      const env = ticket.taskId ? await deps.environments.getEnvironment(ticket.taskId as TaskId) : undefined;
      if (!stopped && (!env || env.state !== 'released')) blockedBy.push('runtime_stop_unconfirmed');
      canStopRuntime = !!ticket.taskId && (!!env || !!deps.environments.blockBusinessAdmission) && env?.state !== 'released' && (ticket.state === 'unknown' || !blockedBy.includes('owner_process_not_stopped') && !blockedBy.includes('owner_identity_missing'));
    }
    return { id: ticket.id, kind: ticket.kind, state: ticket.state === 'unknown' ? 'unknown' : 'open', createdAt: ticket.createdAt,
      ...(ticket.taskId ? { taskId: ticket.taskId } : {}), ...(ticket.ownerPodUid ? { ownerPodUid: ticket.ownerPodUid } : {}), blockedBy, canStopRuntime };
  };
  return {
    legacyRecovery: async (actor: Actor, identity: string, action: 'inspect' | 'reconcile' | 'stop', ticketId?: string): Promise<LegacyRecoveryResult> => {
      const resolved = await service(actor, identity);
      const run = async () => {
      let recovered = 0;
      let stoppedTicket: string | undefined;
      const records = await tickets.list(resolved.serviceId);
      if (action === 'stop') {
        const ticket = records.find((item) => item.id === ticketId); if (!ticket) throw notFound('旧执行票据', ticketId);
        const diagnostic = await inspect(ticket);
        if (!diagnostic.canStopRuntime || !ticket.taskId) throw precondition('票据没有可安全终止的已知运行环境', { blockedBy: diagnostic.blockedBy });
        // This explicit administrator action stops the whole referenced runtime, including all its commands.
        if (!await deps.environments.getEnvironment(ticket.taskId as TaskId) && await deps.environments.blockBusinessAdmission?.(resolved.serviceId, ticket.taskId as TaskId)) stoppedTicket = ticket.id;
        else await deps.environments.releaseEnvironment(ticket.taskId as TaskId, 'failed');
      }
      if (action !== 'inspect') for (const record of records) {
        if (!(await inspect(record, record.id === stoppedTicket)).blockedBy.length && await tickets.recover(record)) recovered++;
      }
      const items = await Promise.all((await tickets.list(resolved.serviceId)).map((record) => inspect(record)));
      return { recovered, items };
      };
      return action === 'inspect' || !deps.projectWork ? run() : deps.projectWork.run({ projectId: resolved.projectId, serviceId: resolved.serviceId,
        kind: 'legacy-api', reference: ticketId ?? resolved.serviceId, inputDigest: jsonHash({ action, ticketId }) }, run);
    },
  };
}
