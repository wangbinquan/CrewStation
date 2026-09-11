import { describe, expect, test } from 'bun:test';
import { downstreamHeaders, proxyError } from './upstreamResponse';

describe('downstreamHeaders', () => {
  test('上游的业务头原样回传：分页与限流是调用方要的信息', () => {
    const upstream = new Headers({
      'content-type': 'application/json', 'x-total': '42', 'x-next-page': '2',
      'ratelimit-remaining': '599', link: '<http://gitlab/api/v4/projects?page=2>; rel="next"',
    });
    const out = downstreamHeaders(upstream);
    expect(out.get('content-type')).toBe('application/json');
    expect(out.get('x-total')).toBe('42');
    expect(out.get('x-next-page')).toBe('2');
    expect(out.get('ratelimit-remaining')).toBe('599');
    expect(out.get('link')).toContain('rel="next"');
  });

  test('content-encoding 与 content-length 不回传：响应体已由 fetch 解压，带上会让调用方二次解压失败', () => {
    const out = downstreamHeaders(new Headers({ 'content-encoding': 'gzip', 'content-length': '120' }));
    expect(out.has('content-encoding')).toBe(false);
    expect(out.has('content-length')).toBe(false);
  });

  test('set-cookie 与逐跳头不回传', () => {
    const out = downstreamHeaders(new Headers({ 'set-cookie': '_gitlab_session=x', connection: 'keep-alive', 'transfer-encoding': 'chunked' }));
    for (const name of ['set-cookie', 'connection', 'transfer-encoding']) expect(out.has(name)).toBe(false);
  });

  test('有 traceId 就回显', () => {
    const traceId = 'a'.repeat(32);
    expect(downstreamHeaders(new Headers(), traceId).get('x-cs-trace-id')).toBe(traceId);
    expect(downstreamHeaders(new Headers(), null).has('x-cs-trace-id')).toBe(false);
  });
});

describe('proxyError', () => {
  test('用平台错误信封，并带上 traceId', async () => {
    const res = proxyError('unavailable', '连接上游失败', 502, 'b'.repeat(32));
    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('x-cs-trace-id')).toBe('b'.repeat(32));
    expect(await res.json()).toEqual({ error: 'unavailable', message: '连接上游失败', details: {} });
  });
});
