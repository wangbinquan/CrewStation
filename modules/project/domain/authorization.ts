import type { MemberRole } from '@crewstation/contracts';

/** 项目内动作；Design §7.3 的角色表在这里落成代码，其他模块经 api.authorize 复用。 */
export type ProjectAction =
  | 'view' | 'develop' | 'publish' | 'switch-traffic' | 'manage-members' | 'manage-testers'
  | 'approve-data-access' | 'manage-production-config' | 'manage-development-config'
  | 'force-release-session' | 'view-preview' | 'manage-alerts' | 'manage-quota' | 'archive';

export type EffectiveRole = MemberRole | 'admin';

const DEVELOPER_ACTIONS: readonly ProjectAction[] = ['view', 'develop', 'publish', 'manage-development-config', 'view-preview'];
const OWNER_ACTIONS: readonly ProjectAction[] = [
  ...DEVELOPER_ACTIONS, 'switch-traffic', 'manage-members', 'manage-testers', 'approve-data-access',
  'manage-production-config', 'force-release-session', 'manage-alerts',
];
const TESTER_ACTIONS: readonly ProjectAction[] = ['view-preview'];

export function isAllowed(role: EffectiveRole | undefined, action: ProjectAction): boolean {
  switch (role) {
    case 'admin': return true;
    case 'owner': return OWNER_ACTIONS.includes(action);
    case 'developer': return DEVELOPER_ACTIONS.includes(action);
    case 'tester': return TESTER_ACTIONS.includes(action);
    default: return false;
  }
}
