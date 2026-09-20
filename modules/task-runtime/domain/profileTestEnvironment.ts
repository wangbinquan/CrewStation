import type { BeforeStartStep, McpConnection, ProjectId, ServiceId } from '@crewstation/contracts';
import { BUILTIN_RESOURCES, IDENTITY_HEADERS, scanTemplate } from '@crewstation/contracts';

/**
 * 管理员档位测试的平台专属任务（RFC-006 §6）：跑在系统命名空间，不属于任何租户项目。
 * 用固定的哨兵项目 ID 复用配额准入表，从而给并发测试一个上限；它不是真实项目，不能出现在租户查询里。
 * 哨兵 ID 沿用 RFC-004 运行环境检查的取值，准入计数行随之延续。
 */
export const PROFILE_TEST_PROJECT_ID = BUILTIN_RESOURCES.profileTestProject as ProjectId;
export const PROFILE_TEST_SERVICE_ID = BUILTIN_RESOURCES.profileTestService as ServiceId;
export const PROFILE_TEST_MAX_CONCURRENT = 4;
export const PROFILE_TEST_LABELS = { project: 'platform', service: 'profile-test' } as const;

/**
 * 档位测试里 `{{mcp.*}}` 的取值（RFC-006 C16）：启动前步骤的内容模板引用了 mcp.* 时，给平台两个 MCP 的真实地址，
 * 令牌是不授予任何权限的占位值——测试验证模板能展开、步骤能执行，不验证 MCP 连通（agent-workflow 的冒烟同样不带 MCP）。
 * 没引用时照旧不给，测试轮次不注入 MCP。路径模板按契约不能引用 mcp.*，只需看文件步骤的内容。
 */
export const PROFILE_TEST_MCP_TOKEN = 'crewstation-profile-test-no-mcp-access';

export function profileTestMcp(steps: readonly BeforeStartStep[], endpoints: ReadonlyArray<{ name: string; url: string }>): McpConnection[] {
  const referencesMcp = steps.some((step) => step.kind === 'file' && scanTemplate(step.contentTemplate).some((token) => token.reference?.kind === 'context' && token.reference.name.startsWith('mcp.')));
  return referencesMcp ? endpoints.map((e) => ({ name: e.name, url: e.url, headers: { [IDENTITY_HEADERS.devSessionToken]: PROFILE_TEST_MCP_TOKEN } })) : [];
}
