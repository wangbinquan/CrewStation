export type DevRoleKey = 'admin' | 'developer' | 'tester' | 'member';
export type ProjectMemberRole = 'developer' | 'tester';

export interface DevRole {
  readonly key: DevRoleKey;
  readonly sub: string;
  readonly username: string;
  readonly name: string;
  readonly email: string;
  readonly title: string;
  readonly summary: string;
  readonly isAdmin: boolean;
  readonly memberRole: ProjectMemberRole | null;
}

/** 固定 subject 保证 dev-auth 重启后仍命中原账户；owner 会改变项目所有权，故不提供快捷入口。 */
export const DEV_ROLES: readonly DevRole[] = [
  {
    key: 'admin', sub: 'dev-role-admin', username: 'dev-admin', name: '开发环境 · 平台管理员',
    email: 'dev-admin@roles.localhost', title: '平台管理员', summary: '查看管理空间、租户与全局配置。', isAdmin: true, memberRole: null,
  },
  {
    key: 'developer', sub: 'dev-role-developer', username: 'dev-developer', name: '开发环境 · 开发者',
    email: 'dev-developer@roles.localhost', title: '项目开发者', summary: '进入选定项目，开发、预览并管理版本。', isAdmin: false, memberRole: 'developer',
  },
  {
    key: 'tester', sub: 'dev-role-tester', username: 'dev-tester', name: '开发环境 · 测试者',
    email: 'dev-tester@roles.localhost', title: '项目测试者', summary: '进入选定项目，验收预览与生产版本。', isAdmin: false, memberRole: 'tester',
  },
  {
    key: 'member', sub: 'dev-role-member', username: 'dev-member', name: '开发环境 · 普通成员',
    email: 'dev-member@roles.localhost', title: '普通成员', summary: '没有项目成员关系，验证公开能力与空状态。', isAdmin: false, memberRole: null,
  },
] as const;

export function findDevRole(value: string | null | undefined): DevRole | undefined {
  return DEV_ROLES.find((role) => role.key === value || role.sub === value);
}
