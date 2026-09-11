import { describe, expect, test } from 'bun:test';
import { normalizeHost, resolveHostByPattern } from './hosts';

describe('host patterns', () => {
  test('console、prod、preview、dev 四种主机；端口与大小写被忽略', () => {
    expect(resolveHostByPattern('console.cs.localhost', 'cs.localhost')).toEqual({ kind: 'console' });
    expect(resolveHostByPattern('Demo.cs.localhost:8080', 'cs.localhost')).toEqual({ kind: 'service-user', identity: 'demo/demo', projectSlug: 'demo', slot: 'prod' });
    expect(resolveHostByPattern('preview.demo.cs.localhost', 'cs.localhost')).toEqual({ kind: 'service-user', identity: 'demo/demo', projectSlug: 'demo', slot: 'preview' });
    expect(resolveHostByPattern('dev.demo.cs.localhost', 'cs.localhost')).toEqual({ kind: 'service-user', identity: 'demo/demo', projectSlug: 'demo', slot: 'dev' });
    expect(normalizeHost(' A.B:443 ')).toBe('a.b');
  });

  test('用户域之外、层级不符或 slug 非法的主机不解析', () => {
    expect(resolveHostByPattern('evil.com', 'cs.localhost')).toBeUndefined();
    expect(resolveHostByPattern('cs.localhost', 'cs.localhost')).toBeUndefined();
    expect(resolveHostByPattern('x.y.demo.cs.localhost', 'cs.localhost')).toBeUndefined();
    expect(resolveHostByPattern('demo.cs.localhost.evil.com', 'cs.localhost')).toBeUndefined();
    expect(resolveHostByPattern('1demo.cs.localhost', 'cs.localhost')).toBeUndefined();
    expect(resolveHostByPattern('demo.cs-localhost', 'cs.localhost')).toBeUndefined();
  });
});
