import { describe, expect, test } from 'bun:test';
import { UPSTREAM_TOKEN_HEADER, forwardedHeaders, hasRequestBody, planUpstreamRequest } from './upstreamRequest';

const plan = (requestUrl: string, extra: Partial<Parameters<typeof planUpstreamRequest>[0]> = {}): ReturnType<typeof planUpstreamRequest> =>
  planUpstreamRequest({ requestUrl, method: 'GET', headers: new Headers(), upstreamBaseUrl: 'http://gitlab.test:8929', ...extra });

describe('planUpstreamRequest', () => {
  test('在上游地址后补 /api，再原样接上路径与查询串', () => {
    expect(plan('http://test-gitlab.svc.cs.internal/v4/projects').url).toBe('http://gitlab.test:8929/api/v4/projects');
    expect(plan('http://test-gitlab.svc.cs.internal/v4/projects?per_page=5&search=demo').url)
      .toBe('http://gitlab.test:8929/api/v4/projects?per_page=5&search=demo');
  });

  test('路径里的编码原样保留：group%2Fproject 不能被解成两段', () => {
    expect(plan('http://x/v4/projects/crewstation%2Fdemo/repository/branches').url)
      .toBe('http://gitlab.test:8929/api/v4/projects/crewstation%2Fdemo/repository/branches');
    expect(plan('http://x/v4/projects/1/repository/branches/feature%2Fa').url)
      .toBe('http://gitlab.test:8929/api/v4/projects/1/repository/branches/feature%2Fa');
  });

  test('方法原样带过去，只做大写归一', () => {
    expect(plan('http://x/v4/projects', { method: 'post' }).method).toBe('POST');
    expect(plan('http://x/v4/projects', { method: 'DELETE' }).method).toBe('DELETE');
  });

  test('上游地址末尾斜杠不会拼出双斜杠', () => {
    expect(plan('http://x/v4/projects', { upstreamBaseUrl: 'http://gitlab.test:8929' }).url).not.toContain('//api');
  });
});

describe('forwardedHeaders', () => {
  test('注入平台给的上游令牌', () => {
    expect(forwardedHeaders(new Headers(), 'glpat-s3cret').get(UPSTREAM_TOKEN_HEADER)).toBe('glpat-s3cret');
    expect(forwardedHeaders(new Headers(), null).has(UPSTREAM_TOKEN_HEADER)).toBe(false);
    expect(forwardedHeaders(new Headers(), '').has(UPSTREAM_TOKEN_HEADER)).toBe(false);
  });

  test('调用方自带的凭据头一律剥掉，顶不掉平台注入的令牌', () => {
    const incoming = new Headers({ authorization: 'Bearer forged', 'private-token': 'forged', 'job-token': 'forged', cookie: 'a=b' });
    const out = forwardedHeaders(incoming, 'glpat-real');
    expect(out.get(UPSTREAM_TOKEN_HEADER)).toBe('glpat-real');
    expect(out.has('authorization')).toBe(false);
    expect(out.has('job-token')).toBe(false);
    expect(out.has('cookie')).toBe(false);
    // 没有平台令牌时也不能让调用方的伪造凭据漏过去。
    expect(forwardedHeaders(incoming, null).has('private-token')).toBe(false);
  });

  test('逐跳头与 host／content-length 不转发', () => {
    const incoming = new Headers({ host: 'test-gitlab.svc.cs.internal', 'content-length': '12', connection: 'keep-alive', 'transfer-encoding': 'chunked' });
    const out = forwardedHeaders(incoming);
    for (const name of ['host', 'content-length', 'connection', 'transfer-encoding']) expect(out.has(name)).toBe(false);
  });

  test('x-cs-* 平台身份头不外泄，只透传 traceId', () => {
    const incoming = new Headers({
      'x-cs-source-service': 'issue-bot/issue-bot', 'x-cs-source-token': 'jwt', 'x-cs-identity-token': 'jwt',
      'x-cs-trace-id': 'f'.repeat(32),
    });
    const out = forwardedHeaders(incoming);
    expect(out.get('x-cs-trace-id')).toBe('f'.repeat(32));
    expect(out.has('x-cs-source-service')).toBe(false);
    expect(out.has('x-cs-source-token')).toBe(false);
    expect(out.has('x-cs-identity-token')).toBe(false);
  });

  test('业务自己的头原样带过去', () => {
    const out = forwardedHeaders(new Headers({ accept: 'application/json', 'content-type': 'application/json', 'x-request-id': 'r1' }));
    expect(out.get('accept')).toBe('application/json');
    expect(out.get('content-type')).toBe('application/json');
    expect(out.get('x-request-id')).toBe('r1');
  });
});

describe('hasRequestBody', () => {
  test('只有 GET／HEAD 没有请求体', () => {
    expect(hasRequestBody('GET')).toBe(false);
    expect(hasRequestBody('head')).toBe(false);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(hasRequestBody(method)).toBe(true);
  });
});
