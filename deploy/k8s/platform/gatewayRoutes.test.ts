import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Doc { kind: string; metadata: { name: string }; spec: { routes?: Array<{ match: string; priority?: number; middlewares?: Array<{ name: string }> }>; rateLimit?: Record<string, unknown>; inFlightReq?: Record<string, unknown> } }
const docs = (Bun.YAML.parse(readFileSync(join(import.meta.dir, '40-gateway.yaml'), 'utf8')) as Doc[]).filter(Boolean);
const route = (name: string) => docs.find((doc) => doc.kind === 'IngressRoute' && doc.metadata.name === name)!.spec.routes![0]!;
const chain = (name: string) => route(name).middlewares?.map((entry) => entry.name);

describe('平台自身路由的限流（RFC-025 T10，设计 §7.3）', () => {
  test('平台接口在用户 ForwardAuth 之后挂令牌桶与并发上限，都按网关注入的用户头分桶；取值是内置默认', () => {
    expect(chain('console-api')).toEqual(['drop-identity-headers', 'forward-auth-user', 'rate-limit-platform-api', 'in-flight-platform-api']);
    const middleware = (name: string) => docs.find((doc) => doc.kind === 'Middleware' && doc.metadata.name === name)!.spec;
    expect(middleware('rate-limit-platform-api').rateLimit).toEqual({ average: 20, burst: 40, period: '1s', sourceCriterion: { requestHeaderName: 'x-cs-user-id' } });
    expect(middleware('in-flight-platform-api').inFlightReq).toEqual({ amount: 16, sourceCriterion: { requestHeaderName: 'x-cs-user-id' } });
  });

  test('长连接不挂并发上限：资源推送流单独一条、优先于平台接口；任务流照旧；登录不经限流', () => {
    const streams = route('console-resource-streams');
    expect(streams.priority).toBeGreaterThan(route('console-api').priority!);
    expect(chain('console-resource-streams')).toEqual(['drop-identity-headers', 'forward-auth-user', 'rate-limit-platform-api']);
    const pattern = new RegExp(/PathRegexp\(`(.+)`\)/.exec(streams.match)![1]!);
    for (const path of ['/v1/projects/01a0bf5d-8f4b-7b10-9a12-5e7d8c4b3a66/resources/stream', '/v1/admin/resources/stream']) expect(pattern.test(path)).toBe(true);
    for (const path of ['/v1/projects/p/resources', '/v1/projects/p/resources/stream/x', '/v1/tasks/t/stream']) expect(pattern.test(path)).toBe(false);
    expect(chain('console-stream')).not.toContain('in-flight-platform-api');
    expect(chain('console-auth')).toEqual(['drop-identity-headers']);
  });
});
