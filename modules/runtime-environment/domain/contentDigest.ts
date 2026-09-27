const sha256 = (text: string): string => new Bun.CryptoHasher('sha256').update(text).digest('hex');

/** 输入已由严格 Schema 解析；对象键排序使幂等键不受 HTTP 属性顺序影响。 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]));
  return value;
}
export const imageContentDigest = (value: unknown): string => `sha256:${sha256(JSON.stringify(canonical(value)))}`;
