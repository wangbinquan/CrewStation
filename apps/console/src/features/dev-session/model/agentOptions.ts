import type { AgentDriver, AgentPermission, TaskDataMode } from '@crewstation/contracts';

/**
 * 下拉选项的取值。用 Record 而不是数组字面量：contracts 里的枚举一旦增删，这里会编译失败，
 * 不会出现界面上少一个选项而没人发现的情况。值为 null 只是占位，键才是取值。
 */
const DRIVERS: Readonly<Record<AgentDriver, null>> = { 'claude-code': null, opencode: null, stub: null };
const PERMISSIONS: Readonly<Record<AgentPermission, null>> = { 'read-only': null, edit: null, full: null };
const DATA_MODES: Readonly<Record<TaskDataMode, null>> = { development: null, 'diagnostic-readonly': null, 'production-change': null };

export const AGENT_DRIVERS = Object.keys(DRIVERS) as readonly AgentDriver[];
export const AGENT_PERMISSIONS = Object.keys(PERMISSIONS) as readonly AgentPermission[];
export const TASK_DATA_MODES = Object.keys(DATA_MODES) as readonly TaskDataMode[];

/** development 直连开发库，随开会话即生效；另外两种要负责人批准。 */
export function needsApproval(mode: TaskDataMode): boolean {
  return mode !== 'development';
}
