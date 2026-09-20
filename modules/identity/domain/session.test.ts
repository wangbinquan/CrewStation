import { describe, expect, test } from 'bun:test';
import type { UserId } from '@crewstation/contracts';
import { consoleUrl, loginUrl, resolveReturnTo, schemeOf, sessionCookie, userIdFromSubject, userSubject, withSessionDefaults } from './session';

const settings = withSessionDefaults({ userDomain: 'cs.localhost' });

describe('session domain', () => {
  test('缺省配置：Cookie Domain 取用户域前加点，不安全，8 小时', () => {
    expect(settings).toEqual({ userDomain: 'cs.localhost', cookieDomain: '.cs.localhost', secure: false, sessionTtlSeconds: 28800 });
    expect(sessionCookie(settings)).toMatchObject({ name: 'cs_session', domain: '.cs.localhost', path: '/', httpOnly: true, sameSite: 'Lax', secure: false, maxAgeSeconds: 28800 });
    expect(withSessionDefaults({ userDomain: 'Corp.Example', secure: true }).cookieDomain).toBe('.corp.example');
  });

  test('returnTo 只接受用户域内地址，相对路径按工作台解析，其余回工作台', () => {
    expect(resolveReturnTo('http://demo.cs.localhost/app?x=1', settings)).toBe('http://demo.cs.localhost/app?x=1');
    expect(resolveReturnTo('https://preview.demo.cs.localhost/', settings)).toBe('https://preview.demo.cs.localhost/');
    expect(resolveReturnTo('/projects/1', settings)).toBe('http://console.cs.localhost/projects/1');
    expect(resolveReturnTo(undefined, settings)).toBe('http://console.cs.localhost/');
    expect(resolveReturnTo('http://evil.com/', settings)).toBe('http://console.cs.localhost/');
    expect(resolveReturnTo('http://evilcs.localhost/', settings)).toBe('http://console.cs.localhost/');
    expect(resolveReturnTo('javascript:alert(1)', settings)).toBe('http://console.cs.localhost/');
    expect(resolveReturnTo('http://user:pw@demo.cs.localhost/', settings)).toBe('http://console.cs.localhost/');
    expect(resolveReturnTo('//evil.com/x', settings)).toBe('http://console.cs.localhost/');
    expect(resolveReturnTo('http://demo.cs.localhost/x', settings, 'https')).toBe('http://demo.cs.localhost/x');
    expect(resolveReturnTo(undefined, settings, 'https')).toBe('https://console.cs.localhost/');
  });

  test('scheme 优先取网关转发值，其次按安装配置', () => {
    expect(schemeOf(settings)).toBe('http');
    expect(schemeOf(settings, 'https')).toBe('https');
    expect(schemeOf(settings, 'gopher')).toBe('http');
    expect(schemeOf({ ...settings, secure: true })).toBe('https');
    expect(consoleUrl({ ...settings, secure: true })).toBe('https://console.cs.localhost/');
    expect(loginUrl(settings, 'http://demo.cs.localhost/a?b=1')).toBe('http://console.cs.localhost/auth/login?returnTo=http%3A%2F%2Fdemo.cs.localhost%2Fa%3Fb%3D1');
  });

  test('会话主体 user:<id> 往返，非法主体返回 undefined', () => {
    const id = '01a0bf5d-8f4b-7793-867c-efd7527b386b' as UserId;
    expect(userSubject(id)).toBe(`user:${id}`);
    expect(userIdFromSubject(userSubject(id))).toBe(id);
    expect(userIdFromSubject('service:demo/demo')).toBeUndefined();
    expect(userIdFromSubject('user:nope')).toBeUndefined();
  });
});
