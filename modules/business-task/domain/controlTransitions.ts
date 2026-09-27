import type { BusinessControlActivate, BusinessControlLeaseRequest, BusinessHandoffReady } from '@crewstation/contracts';
import { conflict, forbidden, precondition } from '@crewstation/kernel';
import type { ExecutionAuthority, ExecutionControl } from './executionControl';
import { assertControlLease, assertControlSource, CONTROL_LEASE_SECONDS, liveControl, nextEpoch } from './executionControl';

const expires = (now: Date) => new Date(now.getTime() + CONTROL_LEASE_SECONDS * 1000).toISOString();
export function claimControl(serviceId: string, current: ExecutionControl | undefined, source: ExecutionAuthority, instanceId: string, leaseId: string, now: Date): ExecutionControl {
  if (current?.migration) throw precondition('迁移停写屏障尚未解除，不能申请执行权');
  if (!current && source.role !== 'prod') throw forbidden('待命槽不能初始化生产执行权');
  const initial: ExecutionControl = current ?? { serviceId, activeReleaseId: source.releaseId, physicalSlot: source.physicalSlot, epoch: 1,
    phase: 'inactive', leaseId: null, leaseOwner: null, leasePodUid: null, leaseExpiresAt: null, preparationDigest: null };
  assertControlSource(initial, source);
  if (liveControl(initial, now)) {
    if (initial.leaseOwner === instanceId && initial.leasePodUid === source.podUid) return initial;
    throw conflict('另一个实例持有执行权', { code: 'execution_lease_busy' });
  }
  return { ...initial, epoch: current ? nextEpoch(current.epoch) : 1, phase: 'preparing', leaseId, leaseOwner: instanceId, leasePodUid: source.podUid, leaseExpiresAt: expires(now), preparationDigest: null };
}
export function renewControl(current: ExecutionControl, source: ExecutionAuthority, input: BusinessControlLeaseRequest, now: Date): ExecutionControl {
  assertControlLease(current, source, input, now);
  if (!['preparing', 'active'].includes(current.phase)) throw conflict('执行权已冻结', { code: 'stale_generation' });
  return { ...current, leaseExpiresAt: expires(now) };
}
export function releaseControl(current: ExecutionControl, source: ExecutionAuthority, input: BusinessControlLeaseRequest, now: Date): ExecutionControl {
  assertControlLease(current, source, input, now);
  const handingOff = current.handoff && current.handoff.stage !== 'complete';
  return { ...current, epoch: nextEpoch(current.epoch), phase: handingOff ? 'frozen' : 'inactive', leaseId: null, leaseOwner: null, leasePodUid: null, leaseExpiresAt: null, preparationDigest: null };
}
export function activateControl(current: ExecutionControl, source: ExecutionAuthority, input: BusinessControlActivate, now: Date): ExecutionControl {
  assertControlLease(current, source, input, now);
  if (current.preparationDigest && current.preparationDigest !== input.preparationDigest) throw conflict('准备回执与已确认内容不同', { code: 'preparation_conflict' });
  if (current.handoff && current.handoff.stage !== 'complete') {
    if (current.handoff.stage !== 'routed' || !current.preparationDigest) throw precondition('交接准备或目标路由尚未确认', { code: 'handoff_not_ready' });
    return { ...current, activeReleaseId: current.handoff.targetReleaseId, physicalSlot: current.handoff.targetSlot, phase: 'active', handoff: { ...current.handoff, stage: 'complete' } };
  }
  if (!['preparing', 'active'].includes(current.phase)) throw precondition('必须先申请准备租约');
  return { ...current, phase: 'active', preparationDigest: input.preparationDigest };
}
export function prepareHandoff(current: ExecutionControl, source: ExecutionAuthority, input: BusinessHandoffReady, now: Date): ExecutionControl {
  assertControlLease(current, source, input, now);
  if (!current.handoff || current.handoff.operationId !== input.operationId) throw conflict('交接操作已变化', { code: 'stale_generation' });
  if (current.preparationDigest && current.preparationDigest !== input.preparationDigest) throw conflict('准备回执与已确认内容不同', { code: 'preparation_conflict' });
  if (current.handoff.acceptedTaskContractVersions && JSON.stringify([...current.handoff.acceptedTaskContractVersions].sort()) !== JSON.stringify([...new Set(input.acceptedTaskContractVersions)].sort())) throw conflict('重复准备回执的任务版本声明不同');
  if (current.handoff.stage === 'complete') return current;
  return { ...current, preparationDigest: input.preparationDigest,
    handoff: { ...current.handoff, stage: current.handoff.stage === 'routed' ? 'routed' : 'prepared', acceptedTaskContractVersions: [...new Set(input.acceptedTaskContractVersions)] } };
}
