import { describe, expect, test } from 'bun:test';
import { rateLimitDraft, validateRateLimits } from './rateLimitDraft';

const limits = {
  platformApi: { perUser: { average: 20, burst: 40 }, inFlightPerUser: 16 },
  userDomain: { perUser: { average: 30, burst: 60 }, perHost: { average: 300, burst: 600 } },
  serviceDomain: { perSource: { average: 50, burst: 100 }, perTarget: { average: 500, burst: 1000 } },
};

describe('限流设置的草稿与校验（RFC-025 T10）', () => {
  test('草稿按现值填好；原样提交得到同样的取值', () => {
    const draft = rateLimitDraft(limits);
    expect(draft).toMatchObject({ 'platformApi.perUser.average': '20', 'platformApi.inFlightPerUser': '16', 'serviceDomain.perTarget.burst': '1000' });
    expect(validateRateLimits(draft, ['platformApi', 'userDomain', 'serviceDomain'])).toEqual({ errors: {}, limits });
    expect(rateLimitDraft({ userDomain: limits.userDomain })).toEqual({ 'userDomain.perUser.average': '30', 'userDomain.perUser.burst': '60', 'userDomain.perHost.average': '300', 'userDomain.perHost.burst': '600' });
  });

  test('只校验要的那几组；不是正整数或超出范围、突发小于平均，都指到那个字段', () => {
    const draft = { ...rateLimitDraft(limits), 'userDomain.perUser.average': '0', 'userDomain.perHost.burst': '10', 'platformApi.inFlightPerUser': '1.5' };
    expect(validateRateLimits(draft, ['userDomain'])).toEqual({ errors: { 'userDomain.perUser.average': 'admin.settings.rateLimits.range.average', 'userDomain.perHost.burst': 'admin.settings.rateLimits.burstVsAverage' } });
    expect(validateRateLimits(draft, ['platformApi']).errors).toEqual({ 'platformApi.inFlightPerUser': 'admin.settings.rateLimits.range.inFlight' });
    expect(validateRateLimits({ ...rateLimitDraft(limits), 'serviceDomain.perSource.burst': '300000' }, ['serviceDomain']).errors).toEqual({ 'serviceDomain.perSource.burst': 'admin.settings.rateLimits.range.burst' });
    expect(validateRateLimits(rateLimitDraft(limits), ['serviceDomain']).limits).toEqual({ serviceDomain: limits.serviceDomain });
  });
});
