// ← agent-workflow `shared/src/schemas/agent.ts` 的 OPENCODE_PERMISSION_* 常量段（zod schema 不复制）。
//
// agent-workflow 的 `AgentPermission` **就是** opencode 的 permission map 原样透传，没有
// read-only／edit／full 这样的抽象层级；CrewStation 的契约（`manifest/tasks.ts`）反过来只有三档。
// 因此本文件多出源里没有的一层：三档 → opencode map。这是 CrewStation 侧的裁定，不是复制来的行为，
// 由 tests/permissionMapping.test.ts 锁住。

import type { AgentPermission } from '@crewstation/contracts';

/** opencode 的动作词表（源：`packages/core/src/v1/config/permission.ts`）。 */
export const OPENCODE_PERMISSION_ACTIONS = ['allow', 'deny', 'ask'] as const;
export type OpencodePermissionAction = (typeof OPENCODE_PERMISSION_ACTIONS)[number];

/** opencode 的已知权限键；`external_directory` 是平台独占键（工作区边界用，CrewStation 不合成）。 */
export const OPENCODE_PERMISSION_KEYS = [
  'read', 'edit', 'glob', 'grep', 'list', 'bash', 'task', 'external_directory',
  'todowrite', 'question', 'webfetch', 'websearch', 'lsp', 'doom_loop', 'skill',
] as const;
export type OpencodePermissionKey = (typeof OPENCODE_PERMISSION_KEYS)[number];

/** 顶层通配键：opencode 把裸动作归一为 `{'*': action}`。 */
export const OPENCODE_PERMISSION_WILDCARD_KEY = '*';

/** 值可以是动作，也可以是 `Record<pattern, 动作>`。 */
export type OpencodePermissionRule = OpencodePermissionAction | Record<string, OpencodePermissionAction>;
export type OpencodePermissionMap = Record<string, OpencodePermissionRule>;

/** 只读档放行的动作类：看得见仓库与网络，写不了任何东西，也起不了子进程。 */
const READ_ONLY_ALLOWED: readonly OpencodePermissionKey[] = ['read', 'glob', 'grep', 'list', 'webfetch', 'websearch'];
/** edit 档在只读之上加写面与辅助面；仍然不给 bash 与 task（起子代理）。 */
const EDIT_ALLOWED: readonly OpencodePermissionKey[] = [...READ_ONLY_ALLOWED, 'edit', 'todowrite', 'question', 'lsp', 'skill'];

/**
 * 三档 → opencode permission map。
 * `full` 用 `{'*': 'allow'}`（opencode 的「全放行」基线，也是 Claude 侧一次性授满 11 个工具的入口）；
 * 另两档逐键列出：opencode 的默认是 allow-unless-denied，只列 allow 会漏放，因此 deny 也显式写出。
 */
export function opencodePermissionFor(level: AgentPermission): OpencodePermissionMap {
  if (level === 'full') return { [OPENCODE_PERMISSION_WILDCARD_KEY]: 'allow' };
  const allowed = new Set<string>(level === 'read-only' ? READ_ONLY_ALLOWED : EDIT_ALLOWED);
  const map: OpencodePermissionMap = {};
  for (const key of OPENCODE_PERMISSION_KEYS) {
    if (key === 'external_directory') continue; // 路径规则不是动作类，工作区边界已裁掉
    map[key] = allowed.has(key) ? 'allow' : 'deny';
  }
  return map;
}
