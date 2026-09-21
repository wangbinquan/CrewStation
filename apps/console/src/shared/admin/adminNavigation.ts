/** 管理空间的页面路径；新增管理页先在这里登记，左栏与总览入口随之出现。 */
export type AdminPagePath =
  | '/admin'
  | '/admin/requests'
  | '/admin/cluster'
  | '/admin/gateway'
  | '/admin/projects'
  | '/admin/capabilities'
  | '/admin/users'
  | '/admin/authentication'
  | '/admin/compute'
  | '/admin/egress';

export interface AdminNavPage {
  readonly to: AdminPagePath;
  readonly labelKey: string;
  readonly exact?: boolean;
}

/** 带标题分组里的页面：总览入口卡片要用一句用途说明。 */
export interface AdminEntryPage extends AdminNavPage {
  readonly hintKey: string;
}

export interface AdminEntryGroup {
  /** 稳定标识：元素 id 与用例定位用，不随文案变。 */
  readonly id: 'observability' | 'supply' | 'identity' | 'resources';
  readonly titleKey: string;
  readonly pages: readonly AdminEntryPage[];
}

/** 左栏首组不带标题：每天先看的待处理入口。总览页自己的「待处理事项」已覆盖它，入口卡片不再重复。 */
export const ADMIN_PENDING_PAGES: readonly AdminNavPage[] = [
  { to: '/admin', labelKey: 'nav.admin.overview', exact: true },
  { to: '/admin/requests', labelKey: 'nav.admin.requests' },
];

/**
 * 管理空间的分组树，左栏与总览入口卡片共用这一份（2026-09-21 修订 RFC-003 §4）。
 * 归属按页面性质：只看运行状态、对运行实例动手的页面进「运行与观测」，保存后影响之后行为的配置页按主题分到后两组；
 * 每页保留独立 URL（RFC-002 §2.1）。
 */
export const ADMIN_ENTRY_GROUPS: readonly AdminEntryGroup[] = [
  { id: 'observability', titleKey: 'nav.admin.groupObservability', pages: [
    { to: '/admin/cluster', labelKey: 'cluster.title', hintKey: 'cluster.description' },
    { to: '/admin/gateway', labelKey: 'nav.admin.gateway', hintKey: 'admin.overview.gateway' },
  ] },
  { id: 'supply', titleKey: 'nav.admin.groupSupply', pages: [
    { to: '/admin/projects', labelKey: 'nav.admin.projects', hintKey: 'admin.directory.description' },
    { to: '/admin/capabilities', labelKey: 'nav.admin.capabilities', hintKey: 'admin.capabilities.hint' },
  ] },
  { id: 'identity', titleKey: 'nav.admin.groupIdentity', pages: [
    { to: '/admin/users', labelKey: 'nav.admin.users', hintKey: 'admin.overview.users' },
    { to: '/admin/authentication', labelKey: 'nav.admin.authentication', hintKey: 'admin.auth.pageHint' },
  ] },
  { id: 'resources', titleKey: 'nav.admin.groupResources', pages: [
    { to: '/admin/compute', labelKey: 'nav.admin.compute', hintKey: 'admin.overview.compute' },
    { to: '/admin/egress', labelKey: 'nav.admin.egress', hintKey: 'admin.overview.egress' },
  ] },
];
