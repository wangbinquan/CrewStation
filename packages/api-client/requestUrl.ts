export type QueryValue = string | number | boolean | undefined;
export type Query = Readonly<Record<string, QueryValue>>;

/** 拼接 baseUrl、路径与查询串；undefined 的查询值不发送。baseUrl 为空时得到同源相对路径。 */
export function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  const encoded = params.toString();
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return encoded ? `${base}${path}${path.includes('?') ? '&' : '?'}${encoded}` : `${base}${path}`;
}

/** 路径段编码：操作键（含 `/` 与 `:`）等必须经它放进路径。 */
export function segment(value: string): string {
  return encodeURIComponent(value);
}
