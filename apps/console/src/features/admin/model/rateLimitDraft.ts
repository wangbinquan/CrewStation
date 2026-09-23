import type { RateLimits } from '@crewstation/contracts';

/** 限流的三组（RFC-025 设计 §7.3）；项目覆盖只有后两组。 */
export type RateLimitGroup = keyof RateLimits;
/** 每组的桶与字段：令牌桶是平均、突发两个数，平台接口另有并发上限一个数。 */
export const RATE_LIMIT_FIELDS = {
  platformApi: ['perUser.average', 'perUser.burst', 'inFlightPerUser'],
  userDomain: ['perUser.average', 'perUser.burst', 'perHost.average', 'perHost.burst'],
  serviceDomain: ['perSource.average', 'perSource.burst', 'perTarget.average', 'perTarget.burst'],
} as const satisfies Record<RateLimitGroup, readonly string[]>;
export type RateLimitField<G extends RateLimitGroup = RateLimitGroup> = (typeof RATE_LIMIT_FIELDS)[G][number];

/** 表单里的数都是字符串，提交前才窄化成整数；键是「组.字段」。 */
export type RateLimitDraft = Readonly<Record<string, string>>;
/** 「组.字段」→ 文案键。 */
export type RateLimitErrors = Readonly<Record<string, string>>;

const key = (group: RateLimitGroup, field: string) => `${group}.${field}`;
/** 与服务端契约同一组上限（packages/contracts/api/rateLimits.ts）。 */
const RANGE = { average: 100_000, burst: 200_000, inFlightPerUser: 10_000 } as const;
const rangeOf = (field: string) => (field.endsWith('.average') ? RANGE.average : field.endsWith('.burst') ? RANGE.burst : RANGE.inFlightPerUser);

function read(limits: Readonly<Record<string, unknown>>, field: string): number {
  return field.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], limits) as number;
}

/** 草稿：给出的几组按现值填好。 */
export function rateLimitDraft(limits: Partial<RateLimits>): RateLimitDraft {
  const draft: Record<string, string> = {};
  for (const group of Object.keys(RATE_LIMIT_FIELDS) as RateLimitGroup[]) {
    const value = limits[group];
    if (value) for (const field of RATE_LIMIT_FIELDS[group]) draft[key(group, field)] = String(read(value, field));
  }
  return draft;
}

function whole(text: string | undefined, max: number): number | undefined {
  const trimmed = (text ?? '').trim(), value = Number(trimmed);
  return /^\d+$/.test(trimmed) && value >= 1 && value <= max ? value : undefined;
}

/**
 * 提交前的校验与服务端一致：正整数且在各自范围内，突发不能小于平均。通过时按组给出结构化的取值（只含要的那几组）。
 */
export function validateRateLimits<G extends RateLimitGroup>(draft: RateLimitDraft, groups: readonly G[]): { readonly errors: RateLimitErrors; readonly limits?: Pick<RateLimits, G> } {
  const errors: Record<string, string> = {}, limits: Record<string, Record<string, unknown>> = {};
  for (const group of groups) {
    const values: Record<string, unknown> = {};
    for (const field of RATE_LIMIT_FIELDS[group]) {
      const value = whole(draft[key(group, field)], rangeOf(field));
      if (value === undefined) { errors[key(group, field)] = `admin.settings.rateLimits.range.${field.endsWith('.average') ? 'average' : field.endsWith('.burst') ? 'burst' : 'inFlight'}`; continue; }
      const [bucket, part] = field.split('.');
      if (part) values[bucket!] = { ...(values[bucket!] as object | undefined), [part]: value };
      else values[bucket!] = value;
    }
    for (const [bucket, value] of Object.entries(values)) {
      const pair = value as { average?: number; burst?: number };
      if (typeof value === 'object' && pair.average !== undefined && pair.burst !== undefined && pair.burst < pair.average) errors[key(group, `${bucket}.burst`)] = 'admin.settings.rateLimits.burstVsAverage';
    }
    limits[group] = values;
  }
  return Object.keys(errors).length ? { errors } : { errors, limits: limits as unknown as Pick<RateLimits, G> };
}
