import { describe, expect, test } from 'bun:test';
import type { ProjectId } from '@crewstation/contracts';
import { DEFAULT_RATE_LIMITS } from './rateLimits';
import { platformRateLimitPolicy, projectRateLimitPolicy } from './rateLimitProjection';

describe('限流策略投影进资源台账（RFC-025 设计 §7.3）', () => {
  test('平台一条：系统命名空间里两个中间件，平台接口按用户一只桶、每人并发上限；展示字段写明取值', () => {
    expect(platformRateLimitPolicy(DEFAULT_RATE_LIMITS.platformApi, 'crewstation-system')).toEqual({
      kind: 'rate-limit-policy', ref: 'platform',
      spec: {
        children: [{ kind: 'Middleware', namespace: 'crewstation-system', name: 'rate-limit-platform-api' }, { kind: 'Middleware', namespace: 'crewstation-system', name: 'in-flight-platform-api' }],
        middlewares: [
          { namespace: 'crewstation-system', name: 'rate-limit-platform-api', rateLimit: { average: 20, burst: 40, key: { header: 'x-cs-user-id' } } },
          { namespace: 'crewstation-system', name: 'in-flight-platform-api', inFlight: { amount: 16, key: { header: 'x-cs-user-id' } } },
        ],
      },
      display: { scope: 'platform', perUser: '20/s·40', inFlightPerUser: '16' },
    });
  });

  test('每个项目一条：项目命名空间里四个中间件，按用户、按主机、按来源服务、按目标；覆盖与否写进展示字段', () => {
    const projectId = '01a0bf5d-8f4b-7b10-9a12-5e7d8c4b3a66' as ProjectId;
    const policy = projectRateLimitPolicy({ projectId, namespace: 'cs-demo' }, DEFAULT_RATE_LIMITS, true);
    expect(policy).toMatchObject({ ref: `project:${projectId}`, projectId, display: { scope: 'project', override: 'true', userPerHost: '300/s·600', servicePerTarget: '500/s·1000' } });
    expect(policy.spec.middlewares.map((entry) => [entry.name, entry.rateLimit?.average, JSON.stringify(entry.rateLimit?.key)])).toEqual([
      ['rate-limit-user', 30, '{"header":"x-cs-user-id"}'], ['rate-limit-host', 300, '{"host":true}'],
      ['rate-limit-source', 50, '{"header":"x-cs-source-service"}'], ['rate-limit-target', 500, '{"host":true}'],
    ]);
    expect(policy.spec.children.every((child) => child.namespace === 'cs-demo')).toBe(true);
  });
});
