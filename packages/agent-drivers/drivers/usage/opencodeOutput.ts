import { readUsage, type UsageObject } from './capture';

/** OpenCode 1.15.5–1.18.31 subtracts reasoning from native output before writing either stream or DB. */
export function opencodeOutput(tokens: UsageObject | undefined, diagnostics: string[]): string | null {
  const read = (value: unknown) => readUsage({ input: 0, output: value, cacheRead: 0, cacheWrite: 0 }, diagnostics).output;
  const output = read(tokens?.['output']), reasoning = read(tokens?.['reasoning']);
  return output === null || reasoning === null ? null : read((BigInt(output) + BigInt(reasoning)).toString());
}
/** The business wire uses safe numbers; larger exact values remain available on the numeric observation stream. */
export function opencodeOutputNumber(tokens: UsageObject | undefined): number | null {
  const exact = opencodeOutput(tokens, []);
  if (exact === null) return null;
  const number = Number(exact);
  return Number.isSafeInteger(number) ? number : null;
}
