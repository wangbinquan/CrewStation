/** 令牌绑定的项目与服务；路径里出现的 ID 必须与它们一致。 */
export interface DevSessionScope {
  readonly projectId: string;
  readonly serviceId: string;
}

type Binding = 'none' | 'project' | 'service' | 'query-service';

interface ScopeRule {
  readonly methods: readonly string[];
  readonly path: RegExp;
  readonly bind: Binding;
}

/**
 * 开发会话令牌能走的接口白名单——只有操作 MCP 的工具真正需要的那几条，其余一律拒绝（失败即关门）。
 * 这样一枚令牌即使泄漏，也不等于会话所属用户的全部权限：它既做不了成员管理、切流、配置与 Secret，
 * 也碰不到别的项目。新增工具时必须同步加一行，否则调用会被这里挡下。
 *
 * `GET /v1/projects` 是唯一不绑项目的一条：MCP 要靠它把网关给的项目 slug 换成不透明 ID，
 * 而返回的本来就只有该用户自己可见的项目清单，只读、不授予任何项目 B 的操作权。
 */
const RULES: readonly ScopeRule[] = [
  { methods: ['GET'], path: /^\/v1\/projects$/, bind: 'none' },
  // capabilities 是能力说明 MCP 用的那条：同一枚令牌注入两个 MCP，只读且同样绑本项目。
  { methods: ['GET'], path: /^\/v1\/projects\/([^/]+)\/(dev-session|branches|logs|health|capabilities)$/, bind: 'project' },
  { methods: ['POST'], path: /^\/v1\/projects\/([^/]+)\/publish$/, bind: 'project' },
  { methods: ['GET'], path: /^\/v1\/services\/([^/]+)\/slots$/, bind: 'service' },
  { methods: ['GET'], path: /^\/v1\/catalog\/operations$/, bind: 'query-service' },
];

/** 放行返回 undefined，拒绝返回给调用方看的原因（不含令牌内容）。 */
export function devSessionScopeDenial(method: string, url: URL, scope: DevSessionScope): string | undefined {
  const verb = method.toUpperCase();
  const rule = RULES.find((candidate) => candidate.methods.includes(verb) && candidate.path.test(url.pathname));
  if (!rule) return `开发会话令牌不能用于 ${verb} ${url.pathname}：它只开放操作 MCP 工具所需的少数接口`;
  if (rule.bind === 'none') return undefined;
  const expected = rule.bind === 'project' ? scope.projectId : scope.serviceId;
  const actual = subjectOf(rule, url);
  // 绑定项拿不到就拒绝：例如不带 serviceId 的接口目录查询会列出全目录，那已经越出本会话。
  if (actual === undefined) return `开发会话令牌调用 ${verb} ${url.pathname} 必须指明本会话所属的 ${rule.bind === 'project' ? '项目' : '服务'}`;
  return actual === expected ? undefined : `开发会话令牌只对本会话所属项目有效，不能操作 ${actual}`;
}

function subjectOf(rule: ScopeRule, url: URL): string | undefined {
  if (rule.bind === 'query-service') return url.searchParams.get('serviceId') ?? undefined;
  const raw = rule.path.exec(url.pathname)?.[1];
  return raw === undefined ? undefined : decodeSegment(raw);
}

/** 路径段是客户端编码过的；解不开就原样比较，最终结果仍是“对不上就拒绝”。 */
function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
