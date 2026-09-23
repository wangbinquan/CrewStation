import type { MemberDto } from '@crewstation/contracts';
import { useDraftTarget } from '../../../shared/lib/useDraftTarget';

/**
 * 成员弹窗的开关与草稿（2026-09-23 起是弹窗）：通用的 useDraftTarget，编辑对象是成员——null 是添加成员，其余是修改这个人的角色。
 * `member`：undefined 表示没有草稿。
 */
export function useMemberPanel() {
  const panel = useDraftTarget<MemberDto | null>((current, next) => (current === null || next === null ? current === next : current.userId === next.userId));
  return { ...panel, member: panel.hasDraft ? panel.target ?? null : undefined };
}
