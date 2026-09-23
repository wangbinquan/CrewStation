import { describe, expect, test } from 'bun:test';
import { middlewareObject } from './middlewareObjects';

describe('调和器渲染的限流 Middleware（RFC-025 设计 §7.3）', () => {
  test('令牌桶：rateLimit 每秒平均与突发、按请求头或主机分桶；带平台标签、组件标签与所属记录的资源 ID', () => {
    expect(middlewareObject({ namespace: 'cs-demo', name: 'rate-limit-user', rateLimit: { average: 30, burst: 60, key: { header: 'x-cs-user-id' } } }, 'rec-1')).toEqual({
      apiVersion: 'traefik.io/v1alpha1', kind: 'Middleware',
      metadata: { name: 'rate-limit-user', namespace: 'cs-demo', labels: { 'app.kubernetes.io/managed-by': 'crewstation', 'app.kubernetes.io/component': 'rate-limit', 'crewstation.io/resource-id': 'rec-1' } },
      spec: { rateLimit: { average: 30, burst: 60, period: '1s', sourceCriterion: { requestHeaderName: 'x-cs-user-id' } } },
    });
    expect(middlewareObject({ namespace: 'cs-demo', name: 'rate-limit-host', rateLimit: { average: 300, burst: 600, key: { host: true } } }, 'rec-1')['spec']).toEqual({ rateLimit: { average: 300, burst: 600, period: '1s', sourceCriterion: { requestHost: true } } });
  });

  test('并发上限：inFlightReq 按请求头分桶', () => {
    expect(middlewareObject({ namespace: 'crewstation-system', name: 'in-flight-platform-api', inFlight: { amount: 16, key: { header: 'x-cs-user-id' } } }, 'rec-p')['spec']).toEqual({ inFlightReq: { amount: 16, sourceCriterion: { requestHeaderName: 'x-cs-user-id' } } });
  });
});
