import type { UserId } from '@crewstation/contracts';

/** 把申请人／审批人的用户 ID 换成可辨识名字；由组合根用 identity 模块实现，查不到返回 undefined。 */
export interface UserDirectory {
  displayName(userId: UserId): Promise<string | undefined>;
}
