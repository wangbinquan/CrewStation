import type { UserId } from '@crewstation/contracts';

/** 由 project 模块经装配提供：preview 与 dev 主机要求项目成员或 preview 测试者，prod 主机只要求登录。 */
export interface PreviewAccess {
  canView(userId: UserId, projectSlug: string, slot: 'preview' | 'dev'): Promise<boolean>;
}
