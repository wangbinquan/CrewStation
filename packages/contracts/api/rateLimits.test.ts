import { describe, expect, test } from 'bun:test';
import { ProjectRateLimitOverrideSchema, SetRateLimitSettingsRequestSchema } from './rateLimits';

const limits = {
  platformApi: { perUser: { average: 20, burst: 40 }, inFlightPerUser: 16 },
  userDomain: { perUser: { average: 30, burst: 60 }, perHost: { average: 300, burst: 600 } },
  serviceDomain: { perSource: { average: 50, burst: 100 }, perTarget: { average: 500, burst: 1000 } },
};

describe('网关限流的契约（RFC-025 设计 §7.3）', () => {
  test('平台默认：三类齐全才收；突发不能小于平均；0 与多出来的字段不收', () => {
    expect(SetRateLimitSettingsRequestSchema.parse({ ...limits, expectedRevision: 0 })).toMatchObject({ platformApi: { inFlightPerUser: 16 } });
    expect(SetRateLimitSettingsRequestSchema.safeParse({ ...limits, userDomain: { ...limits.userDomain, perUser: { average: 30, burst: 10 } }, expectedRevision: 0 }).error?.issues[0]).toMatchObject({ path: ['userDomain', 'perUser', 'burst'], message: '突发不能小于平均' });
    expect(SetRateLimitSettingsRequestSchema.safeParse({ ...limits, platformApi: { ...limits.platformApi, inFlightPerUser: 0 }, expectedRevision: 0 }).success).toBe(false);
    expect(SetRateLimitSettingsRequestSchema.safeParse({ ...limits, expectedRevision: 0, extra: true }).success).toBe(false);
    expect(SetRateLimitSettingsRequestSchema.safeParse({ platformApi: limits.platformApi, expectedRevision: 0 }).success).toBe(false);
  });

  test('项目覆盖：只能覆盖用户域与服务域，可以只写其中一项；平台接口不能按项目改', () => {
    expect(ProjectRateLimitOverrideSchema.parse({ userDomain: limits.userDomain })).toEqual({ userDomain: limits.userDomain });
    expect(ProjectRateLimitOverrideSchema.parse({})).toEqual({});
    expect(ProjectRateLimitOverrideSchema.safeParse({ platformApi: limits.platformApi }).success).toBe(false);
  });
});
