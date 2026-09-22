import { FullCommitShaSchema } from '@crewstation/contracts';
import type { SlotDto } from '@crewstation/contracts';

/** 部署槽的身份齐全：有发布、有标签、有完整 SHA。概览与发布页对「能不能打开、能不能切」用同一把尺子。 */
export function slotIdentityKnown(slot: SlotDto | undefined): boolean {
  return !!slot?.releaseId && !!slot.tag && FullCommitShaSchema.safeParse(slot.commitSha).success;
}
export function slotCanOpen(slot: SlotDto | undefined): boolean {
  return slotIdentityKnown(slot) && slot?.state === 'ready' && slot.replicas > 0 && slot.readyReplicas > 0 && !!slot.host.trim() && validSlotHost(slot.host);
}
/** 访问地址只接受主机名（可带端口），防止把任意字符串拼成链接。 */
export function validSlotHost(host: string): boolean {
  return /^[a-z0-9][a-z0-9.-]*(?::\d+)?$/i.test(host.trim());
}
