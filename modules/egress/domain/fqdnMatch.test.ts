import { describe, expect, test } from 'bun:test';
import { fqdnMatches, hostAllowed, normalizeHost } from './fqdnMatch';

describe('fqdn matching', () => {
  test('精确匹配不区分大小写与末尾点', () => {
    expect(fqdnMatches('api.example.com', 'API.Example.com.')).toBe(true);
    expect(fqdnMatches('api.example.com', 'api.example.org')).toBe(false);
    expect(fqdnMatches('api.example.com', 'x.api.example.com')).toBe(false);
    expect(normalizeHost('  Foo.Bar. ')).toBe('foo.bar');
  });

  test('通配符匹配任意深度子域，不匹配根域本身或后缀相似域', () => {
    expect(fqdnMatches('*.example.com', 'a.example.com')).toBe(true);
    expect(fqdnMatches('*.example.com', 'a.b.example.com')).toBe(true);
    expect(fqdnMatches('*.example.com', 'example.com')).toBe(false);
    expect(fqdnMatches('*.example.com', 'notexample.com')).toBe(false);
    expect(fqdnMatches('*.example.com', 'evil-example.com')).toBe(false);
    expect(fqdnMatches('', 'a.example.com')).toBe(false);
  });

  test('放行清单任一模式命中即放行', () => {
    const allow = ['registry.npmjs.org', '*.internal.example.com'];
    expect(hostAllowed(allow, 'registry.npmjs.org')).toBe(true);
    expect(hostAllowed(allow, 'git.internal.example.com')).toBe(true);
    expect(hostAllowed(allow, 'example.com')).toBe(false);
    expect(hostAllowed([], 'registry.npmjs.org')).toBe(false);
  });
});
