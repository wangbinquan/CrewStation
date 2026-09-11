/** 主机名规范化：小写、去首尾空白与末尾点。 */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * 白名单模式匹配：精确 FQDN 只匹配自身；`*.example.com` 匹配任意深度的子域（a.example.com、a.b.example.com），
 * 不匹配 example.com 本身。出站代理按同一语义放行。
 */
export function fqdnMatches(pattern: string, host: string): boolean {
  const p = normalizeHost(pattern);
  const h = normalizeHost(host);
  if (!p || !h) return false;
  if (!p.startsWith('*.')) return p === h;
  const suffix = p.slice(1);
  return h.length > suffix.length && h.endsWith(suffix);
}

export function hostAllowed(allow: readonly string[], host: string): boolean {
  return allow.some((pattern) => fqdnMatches(pattern, host));
}
