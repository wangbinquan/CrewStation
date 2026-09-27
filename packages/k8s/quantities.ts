import { isDeepStrictEqual } from 'node:util';

/** API Server 会规范化资源数量；按精确有理数比较 requests/limits，保留字段集合约束。 */
function quantity(value: string): [bigint, bigint] | undefined {
  const match = /^(\d+(?:\.\d+)?|\.\d+)([numkKMGTPE]|[KMGTPE]i|[eE][+-]?\d+)?$/.exec(value);
  if (!match) return undefined;
  const [whole = '0', decimal = ''] = match[1]!.split('.'), unit = match[2] ?? '';
  const powers: Record<string, number> = { n: -9, u: -6, m: -3, '': 0, k: 3, K: 3, M: 6, G: 9, T: 12, P: 15, E: 18 };
  const binary = unit.endsWith('i') ? BigInt(1024) ** BigInt('KMGTPE'.indexOf(unit[0]!) + 1) : 1n;
  const exponent = unit.endsWith('i') ? 0 : (powers[unit] ?? Number(unit.slice(1)));
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 30 || decimal.length > 30) return undefined;
  return [BigInt(`${whole || '0'}${decimal}`) * binary * 10n ** BigInt(Math.max(0, exponent)), 10n ** BigInt(decimal.length + Math.max(0, -exponent))];
}
export function resourcesMatch(actual: unknown, expected: Record<string, string>): boolean {
  const resources = actual as Record<string, Record<string, string>> | undefined;
  return ['requests', 'limits'].every((kind) => {
    const values = resources?.[kind];
    if (!values || !isDeepStrictEqual(Object.keys(values).sort(), Object.keys(expected).sort())) return false;
    return Object.entries(expected).every(([key, value]) => {
      if (values[key] === value) return true;
      const a = quantity(String(values[key])), b = quantity(value);
      return a && b && a[0] * b[1] === b[0] * a[1];
    });
  });
}
