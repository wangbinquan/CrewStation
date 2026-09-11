import { describe, expect, test } from 'bun:test';
import { acceptsHtml, firstForwardedIp, firstHost, headerSafe, originalUrl, pathOf } from './forwardedRequest';

describe('forwarded request helpers', () => {
  test('X-Forwarded-For 取第一跳；缺失或空白视为无来源', () => {
    expect(firstForwardedIp('10.244.0.23, 10.244.0.7')).toBe('10.244.0.23');
    expect(firstForwardedIp(' 10.1.1.1 ')).toBe('10.1.1.1');
    expect(firstForwardedIp(undefined)).toBeUndefined();
    expect(firstForwardedIp(' , 1.1.1.1')).toBeUndefined();
    expect(firstHost('demo.cs.localhost, internal')).toBe('demo.cs.localhost');
  });

  test('浏览器判定与原始地址还原', () => {
    expect(acceptsHtml('text/html,application/xhtml+xml,*/*;q=0.8')).toBe(true);
    expect(acceptsHtml('application/json, text/plain')).toBe(false);
    expect(acceptsHtml('*/*')).toBe(false);
    expect(acceptsHtml(undefined)).toBe(false);
    expect(originalUrl('https', 'demo.cs.localhost', '/a?b=1')).toBe('https://demo.cs.localhost/a?b=1');
    expect(originalUrl('http', 'demo.cs.localhost', 'x')).toBe('http://demo.cs.localhost/x');
    expect(pathOf('/api/gitlab/v4/projects?per_page=1')).toBe('/api/gitlab/v4/projects');
    expect(pathOf('')).toBe('/');
  });

  test('头值：ASCII 原样，非 ASCII 按 RFC 8187 编码', () => {
    expect(headerSafe('Alice Liddell')).toBe('Alice Liddell');
    expect(headerSafe('演示用户')).toBe("UTF-8''%E6%BC%94%E7%A4%BA%E7%94%A8%E6%88%B7");
  });
});
