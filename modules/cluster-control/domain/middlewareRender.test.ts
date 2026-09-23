import { describe, expect, test } from 'bun:test';
import { middlewareRendersOf } from './middlewareRender';

describe('限流策略记录的期望 → 中间件渲染输入（RFC-025 设计 §7.3）', () => {
  test('令牌桶按请求头或主机分桶，并发上限按请求头；照写', () => {
    const middlewares = [
      { namespace: 'cs-demo', name: 'rate-limit-user', rateLimit: { average: 30, burst: 60, key: { header: 'x-cs-user-id' } } },
      { namespace: 'cs-demo', name: 'rate-limit-host', rateLimit: { average: 300, burst: 600, key: { host: true } } },
      { namespace: 'crewstation-system', name: 'inflight-platform-api', inFlight: { amount: 16, key: { header: 'x-cs-user-id' } } },
    ];
    expect(middlewareRendersOf({ middlewares }) as unknown).toEqual(middlewares);
  });

  test('记录是数据：缺名字或命名空间、数值不是正整数、分桶方式不认识、两种都没有，整条都不渲染', () => {
    const good = { namespace: 'cs-demo', name: 'rate-limit-user', rateLimit: { average: 30, burst: 60, key: { header: 'x-cs-user-id' } } };
    for (const broken of [
      { ...good, name: '' }, { ...good, namespace: undefined }, { ...good, rateLimit: { ...good.rateLimit, average: 0 } }, { ...good, rateLimit: { ...good.rateLimit, burst: 1.5 } },
      { ...good, rateLimit: { ...good.rateLimit, key: { host: 'yes' } } }, { ...good, rateLimit: { ...good.rateLimit, key: 'x' } }, { namespace: 'cs-demo', name: 'x' },
      { namespace: 'cs-demo', name: 'x', inFlight: { amount: 3, key: {} } },
    ]) expect(middlewareRendersOf({ middlewares: [good, broken] })).toBeUndefined();
    expect(middlewareRendersOf({})).toBeUndefined();
  });
});
