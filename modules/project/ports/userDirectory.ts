import type { UserId } from '@crewstation/contracts';

/** 由 identity 模块提供；project 只需要这两个问题的答案。 */
export interface UserDirectory {
  isAdmin(userId: UserId): Promise<boolean>;
  getUser(userId: UserId): Promise<{ id: UserId; name: string; email: string } | undefined>;
}
