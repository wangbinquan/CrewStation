import { describe, expect, test } from 'bun:test';
import { RateLimitsSchema } from '@crewstation/contracts';
import { DEFAULT_RATE_LIMITS, effectiveProjectLimits } from './rateLimits';

describe('网关限流的默认值与项目覆盖（RFC-025 提案 Q4、设计 §7.3）', () => {
  test('内置默认照 Q4 的设计取值，且本身通过契约校验', () => {
    expect(RateLimitsSchema.parse(DEFAULT_RATE_LIMITS)).toEqual(DEFAULT_RATE_LIMITS);
    expect(DEFAULT_RATE_LIMITS).toMatchObject({ platformApi: { perUser: { average: 20, burst: 40 }, inFlightPerUser: 16 }, userDomain: { perHost: { average: 300 } }, serviceDomain: { perTarget: { average: 500 } } });
  });

  test('覆盖写了哪一项整项照它，没写的照平台默认；没有覆盖就是平台默认', () => {
    const userDomain = { perUser: { average: 5, burst: 10 }, perHost: { average: 50, burst: 100 } };
    expect(effectiveProjectLimits(DEFAULT_RATE_LIMITS, { userDomain })).toEqual({ userDomain, serviceDomain: DEFAULT_RATE_LIMITS.serviceDomain });
    expect(effectiveProjectLimits(DEFAULT_RATE_LIMITS, undefined)).toEqual({ userDomain: DEFAULT_RATE_LIMITS.userDomain, serviceDomain: DEFAULT_RATE_LIMITS.serviceDomain });
  });
});
