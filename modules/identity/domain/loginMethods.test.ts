import { describe, expect, test } from 'bun:test';
import { blocksLastEnabledProvider, bootstrapTokenUsable, canDisablePasswordLogin, loginDiscovery, passwordLoginUsable } from './loginMethods';

const pending = { passwordLoginEnabled: true, bootstrapCompletedAt: null };
const done = { passwordLoginEnabled: true, bootstrapCompletedAt: new Date('2026-09-18T00:00:00Z') };
const closed = { passwordLoginEnabled: false, bootstrapCompletedAt: done.bootstrapCompletedAt };
const providers = [{ slug: 'corp-sso', displayName: '公司统一身份' }];

describe('登录方法发现', () => {
  test('引导未完成只给引导令牌：库里已有 Provider 也不提前暴露 OIDC 或密码入口', () => {
    const discovery = loginDiscovery(pending, providers, false);
    expect(discovery).toMatchObject({ mode: 'bootstrap', passwordLoginEnabled: false, bootstrapTokenEnabled: true, providers: [] });
    expect(passwordLoginUsable(pending, false)).toBe(false);
    // 安装配置的强制开关也不能把引导阶段提前打开，否则「首次只能引导」形同虚设。
    expect(passwordLoginUsable(pending, true)).toBe(false);
    expect(bootstrapTokenUsable(pending)).toBe(true);
  });

  test('引导完成后按策略给方法；引导令牌永久消失', () => {
    expect(loginDiscovery(done, providers, false)).toMatchObject({ mode: 'ready', passwordLoginEnabled: true, bootstrapTokenEnabled: false, providers });
    expect(loginDiscovery(closed, providers, false).passwordLoginEnabled).toBe(false);
    expect(bootstrapTokenUsable(done)).toBe(false);
  });

  test('安装配置强制开关压过库内策略（IdP 全挂时的破窗口）', () => {
    expect(passwordLoginUsable(closed, true)).toBe(true);
    expect(loginDiscovery(closed, providers, true).passwordLoginEnabled).toBe(true);
  });
});

describe('关闭常规登录的前置', () => {
  test('三条同时成立才允许：管理员、当前会话来自 OIDC、至少一个启用 Provider', () => {
    expect(canDisablePasswordLogin({ isAdmin: true, authMethod: 'oidc', enabledProviderCount: 1, forcedOn: false })).toEqual({ allowed: true });
    expect(canDisablePasswordLogin({ isAdmin: false, authMethod: 'oidc', enabledProviderCount: 1, forcedOn: false })).toEqual({ allowed: false, reason: 'not-admin' });
    // 这条是 A2 的核心：密码会话的管理员关不掉，因此不可能出现「关完谁都进不来」。
    expect(canDisablePasswordLogin({ isAdmin: true, authMethod: 'password', enabledProviderCount: 1, forcedOn: false })).toEqual({ allowed: false, reason: 'requires-oidc-session' });
    expect(canDisablePasswordLogin({ isAdmin: true, authMethod: 'oidc', enabledProviderCount: 0, forcedOn: false })).toEqual({ allowed: false, reason: 'requires-enabled-oidc' });
    expect(canDisablePasswordLogin({ isAdmin: true, authMethod: 'oidc', enabledProviderCount: 2, forcedOn: true })).toEqual({ allowed: false, reason: 'forced-on' });
  });
});

describe('最后一个启用 Provider', () => {
  test('密码登录关着时不能停用或删除它，否则没人能再登录', () => {
    expect(blocksLastEnabledProvider({ policy: closed, forcedOn: false, enabledProviderCount: 1, providerWasEnabled: true })).toBe(true);
    expect(blocksLastEnabledProvider({ policy: closed, forcedOn: false, enabledProviderCount: 2, providerWasEnabled: true })).toBe(false);
    expect(blocksLastEnabledProvider({ policy: closed, forcedOn: false, enabledProviderCount: 1, providerWasEnabled: false })).toBe(false);
    expect(blocksLastEnabledProvider({ policy: done, forcedOn: false, enabledProviderCount: 1, providerWasEnabled: true })).toBe(false);
    expect(blocksLastEnabledProvider({ policy: closed, forcedOn: true, enabledProviderCount: 1, providerWasEnabled: true })).toBe(false);
  });
});
