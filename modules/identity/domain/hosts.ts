import { HOST_PATTERNS } from '@crewstation/contracts';

export type UserSlot = 'prod' | 'preview' | 'dev';

/** 用户域 Host 解析结果：工作台，或某项目某槽的业务主机。 */
export type ResolvedHost =
  | { kind: 'console' }
  | { kind: 'service-user'; identity: string; projectSlug: string; slot: UserSlot };

const SLUG_GROUP = '([a-z][a-z0-9-]*)';
const SLOT_PATTERNS: ReadonlyArray<readonly [string, UserSlot]> = [
  [HOST_PATTERNS.preview, 'preview'],
  [HOST_PATTERNS.devPreview, 'dev'],
  [HOST_PATTERNS.prod, 'prod'],
];

/** 去掉端口并小写；Host 头与 X-Forwarded-Host 都可能带端口。 */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '');
}

/** 首版一个项目一个服务且服务名等于项目 slug（与 project 模块 createProject 的约定一致）。 */
export function serviceIdentityOf(projectSlug: string): string {
  return `${projectSlug}/${projectSlug}`;
}

/** 按 contracts 的 HOST_PATTERNS 解析：console 优先，其次 preview／dev，最后 prod。 */
export function resolveHostByPattern(host: string, userDomain: string): ResolvedHost | undefined {
  const normalized = normalizeHost(host);
  if (normalized === HOST_PATTERNS.console.replace('{userDomain}', userDomain.toLowerCase())) return { kind: 'console' };
  for (const [pattern, slot] of SLOT_PATTERNS) {
    const slug = patternToRegex(pattern, userDomain).exec(normalized)?.[1];
    if (slug) return { kind: 'service-user', identity: serviceIdentityOf(slug), projectSlug: slug, slot };
  }
  return undefined;
}

function patternToRegex(pattern: string, userDomain: string): RegExp {
  const source = pattern
    .split(/(\{project\}|\{userDomain\})/)
    .map((segment) => (segment === '{project}' ? SLUG_GROUP : segment === '{userDomain}' ? escapeRegex(userDomain.toLowerCase()) : escapeRegex(segment)))
    .join('');
  return new RegExp(`^${source}$`);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
