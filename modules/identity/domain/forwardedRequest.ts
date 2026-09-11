/** 网关转发头的取值规则；ForwardAuth 请求本身没有业务语义，只有这些头。 */

export function firstForwardedIp(header: string | undefined): string | undefined {
  const first = header?.split(',')[0]?.trim();
  return first ? first : undefined;
}

/** X-Forwarded-Host 可能是逗号分隔的链；只取最外层。 */
export function firstHost(header: string): string {
  return header.split(',')[0]?.trim() ?? '';
}

/** 浏览器导航请求的 Accept 含 text/html；fetch／XHR 默认是 `*／*`，未登录时给 401 而不是跳转。 */
export function acceptsHtml(accept: string | undefined): boolean {
  return (accept ?? '').split(',').some((part) => part.trim().toLowerCase().startsWith('text/html'));
}

export function originalUrl(scheme: string, host: string, uri: string): string {
  return `${scheme}://${host}${uri.startsWith('/') ? uri : `/${uri}`}`;
}

export function pathOf(uri: string): string {
  const path = uri.split('?')[0] ?? '';
  return path.startsWith('/') ? path : `/${path}`;
}

/** HTTP 头只能放 ISO-8859-1：ASCII 原样，其余按 RFC 8187（`UTF-8''<百分号编码>`）；令牌里的 name 声明保留原文。 */
export function headerSafe(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `UTF-8''${encodeURIComponent(value)}`;
}
