import type { Actor, ComparisonDeployment, ComparisonTarget, ServiceId } from '@crewstation/contracts';
import { GitObjectIdSchema } from '@crewstation/contracts';
import type { DevSessionUseCaseDeps } from './dependencies';

/** prod／preview 是当前槽角色，取实际 releaseId 和 commitSha；不借远端分支推测。 */
export async function readComparisonDeployment(deps: DevSessionUseCaseDeps, actor: Actor, serviceId: ServiceId, target: ComparisonTarget): Promise<ComparisonDeployment> {
  try {
    const slot = (await deps.releases.getSlots(actor, serviceId)).find((entry) => entry.name === target);
    if (!slot || slot.state === 'empty') return { status: 'undeployed', target };
    if (!slot.releaseId || !slot.tag || !GitObjectIdSchema.safeParse(slot.commitSha).success) return { status: 'unavailable', target, reason: '部署记录缺少可比较的 releaseId、标签或完整 SHA' };
    return { status: 'ready', target, releaseId: slot.releaseId, tag: slot.tag, commitSha: slot.commitSha!, host: slot.host, state: slot.state };
  } catch (error) {
    deps.logger.warn('comparison deployment unavailable', { serviceId, target, error: String(error) });
    return { status: 'unavailable', target, reason: '无法读取当前部署版本，请重试' };
  }
}
