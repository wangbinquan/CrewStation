import { useCallback } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';

/**
 * 成员 ID → 显示名：别人开的 CLI 在标签与结束确认里写明是谁开的。名单里没有这个人（如不是成员的平台管理员）或名单读不到时写「其他人」：
 * 标签上已经有 CLI 自己的短 ID，再挂一段用户 ID 只会让人分不清（2026-09-23 实机）。
 */
export function useMemberNames(projectId: string): (userId: string) => string {
  const t = useT();
  const members = useApiQuery(queryKeys.members(projectId), () => api.projects.listMembers(projectId));
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const items = members.data?.items, self = me.data, someone = t('devSession.native.someone');
  return useCallback((userId: string) => items?.find((member) => member.userId === userId)?.name ?? (self?.id === userId ? self.name : undefined) ?? someone, [items, self, someone]);
}
