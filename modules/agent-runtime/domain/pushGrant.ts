/**
 * 平台镜像仓库的推送凭据（RFC-006 C18、design §7.2 本机适配）：口令是一张带到期时间与仓库前缀的签名授权，
 * 网关的 ForwardAuth 按它放行 /v2/ 探测与前缀内的推拉；平台不存口令本身，签名密钥派生自平台密钥。
 */
export interface PushGrant {
  /** 签发给哪位管理员（用户 ID），同时作为登录用户名。 */
  readonly sub: string;
  /** 到期时间（Unix 秒）。 */
  readonly exp: number;
  /** 可推可拉的仓库路径；尾部 / 表示前缀，如 runtime/。 */
  readonly push: readonly string[];
  /** 只读仓库路径；没有尾部 / 时精确匹配，如平台底座 crewstation/task-runtime。 */
  readonly pull: readonly string[];
}

const MAC_LABEL = 'crewstation:registry-push:v1:';

const macOf = (key: Uint8Array, body: string): string => new Bun.CryptoHasher('sha256', key).update(`${MAC_LABEL}${body}`).digest('base64url');

export function signGrant(grant: PushGrant, key: Uint8Array): string {
  const body = Buffer.from(JSON.stringify(grant)).toString('base64url');
  return `${body}.${macOf(key, body)}`;
}

/** 签名、结构与到期时间都对才返回授权；任何一项不对都当作没有凭据。 */
export function verifyGrant(token: string, key: Uint8Array, nowSeconds: number): PushGrant | undefined {
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined) return undefined;
  const expected = macOf(key, body);
  if (expected.length !== mac.length || !timingSafeEqualText(expected, mac)) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return undefined; }
  if (!isGrant(parsed) || parsed.exp <= nowSeconds) return undefined;
  return parsed;
}

function timingSafeEqualText(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isGrant(value: unknown): value is PushGrant {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Record<string, unknown>;
  const strings = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length > 0);
  return typeof g.sub === 'string' && typeof g.exp === 'number' && strings(g.push) && strings(g.pull);
}

const READ_METHODS = new Set(['GET', 'HEAD']);
const WRITE_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH']);
const REPOSITORY_PATH = /^\/v2\/((?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*)\/(manifests|blobs|tags)\//;
const REPOSITORY_NAME = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;
const under = (repository: string, prefixes: readonly string[]) => prefixes.some((prefix) => prefix.endsWith('/') ? repository.startsWith(prefix) : repository === prefix);

/** Mount also reads its source. An omitted/ambiguous source must not delegate global blob lookup to the registry. */
function permittedMount(grant: PushGrant, method: string, path: string, repository: string, query: URLSearchParams): boolean {
  if (!query.has('mount') && !query.has('from')) return true;
  const from = query.getAll('from'), mount = query.getAll('mount');
  return method === 'POST' && path === `/v2/${repository}/blobs/uploads/` && from.length === 1 && mount.length === 1
    && REPOSITORY_NAME.test(from[0]!) && /^sha256:[0-9a-f]{64}$/.test(mount[0]!)
    && under(from[0]!, [...grant.push, ...grant.pull]);
}

/**
 * 按方法与路径裁定一次仓库请求：/v2/ 探测放行；推送前缀内可推可拉（不含删除）；只读前缀只能 GET／HEAD；
 * 其余（目录列举、越权路径、删除）一律拒绝。仓库路径按 Distribution 的名字规则解析，`..` 之类的形态匹配不上。
 */
export function registryDecision(grant: PushGrant, method: string, uri: string): 'allow' | 'deny' {
  const path = uri.split('?')[0] ?? '';
  const verb = method.toUpperCase();
  if (path === '/v2/' || path === '/v2') return READ_METHODS.has(verb) ? 'allow' : 'deny';
  const repository = REPOSITORY_PATH.exec(path)?.[1];
  if (!repository) return 'deny';
  const query = new URLSearchParams(uri.includes('?') ? uri.slice(uri.indexOf('?') + 1) : '');
  if (!permittedMount(grant, verb, path, repository, query)) return 'deny';
  if (under(repository, grant.push)) return WRITE_METHODS.has(verb) ? 'allow' : 'deny';
  if (under(repository, grant.pull)) return READ_METHODS.has(verb) ? 'allow' : 'deny';
  return 'deny';
}
