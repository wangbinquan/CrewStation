import { describe, expect, test } from 'bun:test';
import { CliFailure } from '../runtime/cliError';
import { configFilePath, parseConfigFile } from '../runtime/configFile';
import { createPlatformClient, requireToken, SESSION_COOKIE_NAME } from '../runtime/platformAccess';
import type { SettingsInput } from '../runtime/settings';
import { resolveSettings, SETTING_KEYS } from '../runtime/settings';
import { fakeFetch, jsonResponse } from './cliHarness';

const base: SettingsInput = { flags: {}, env: {}, file: {}, configFilePath: '/cfg.json', configFileFound: false };

describe('配置解析顺序：标志 → 环境变量 → 配置文件 → 默认值', () => {
  test('四层都有值时取标志', () => {
    const settings = resolveSettings({ ...base, flags: { api: 'http://flag' }, env: { CS_API_URL: 'http://env' }, file: { apiUrl: 'http://file' } });
    expect(settings.apiUrl).toBe('http://flag');
    expect(settings.sources.apiUrl).toBe('flag');
  });

  test('没有标志时取环境变量', () => {
    const settings = resolveSettings({ ...base, env: { CS_API_URL: 'http://env' }, file: { apiUrl: 'http://file' } });
    expect(settings.apiUrl).toBe('http://env');
    expect(settings.sources.apiUrl).toBe('env');
  });

  test('没有标志与环境变量时取配置文件', () => {
    const settings = resolveSettings({ ...base, file: { apiUrl: 'http://file' } });
    expect(settings.apiUrl).toBe('http://file');
    expect(settings.sources.apiUrl).toBe('file');
  });

  test('都没有时取内置默认值', () => {
    const settings = resolveSettings(base);
    expect(settings.apiUrl).toBe('http://console.cs.localhost');
    expect(settings.sources.apiUrl).toBe('default');
  });

  test('空字符串视为未设置，不挡住下一层', () => {
    const settings = resolveSettings({ ...base, flags: { api: '' }, env: { CS_API_URL: '' }, file: { apiUrl: 'http://file' } });
    expect(settings.apiUrl).toBe('http://file');
  });

  test('没有默认值的键缺省是 unset', () => {
    const settings = resolveSettings(base);
    expect(settings.token).toBeUndefined();
    expect(settings.sources.token).toBe('unset');
    expect(settings.sources.kubeContext).toBe('unset');
  });

  test('令牌与其余键走同一套顺序', () => {
    const settings = resolveSettings({ ...base, env: { CS_TOKEN: 'from-env' }, file: { token: 'from-file' } });
    expect(settings.token).toBe('from-env');
    expect(settings.sources.token).toBe('env');
  });

  test('SETTING_KEYS 标了哪些是机密', () => {
    expect(SETTING_KEYS.filter((key) => key.secret).map((key) => key.name)).toEqual(['token']);
  });
});

describe('配置文件路径与解析', () => {
  test('路径顺序：标志 → CS_CLI_CONFIG → XDG → 家目录', () => {
    const env = { CS_CLI_CONFIG: '/from/env.json', XDG_CONFIG_HOME: '/xdg' };
    expect(configFilePath({ flag: '/from/flag.json', env, homeDir: '/home/u' })).toBe('/from/flag.json');
    expect(configFilePath({ flag: undefined, env, homeDir: '/home/u' })).toBe('/from/env.json');
    expect(configFilePath({ flag: undefined, env: { XDG_CONFIG_HOME: '/xdg' }, homeDir: '/home/u' })).toBe('/xdg/crewstation/config.json');
    expect(configFilePath({ flag: undefined, env: {}, homeDir: '/home/u' })).toBe('/home/u/.config/crewstation/config.json');
  });

  test('只取认识的键，多余的忽略', () => {
    const values = parseConfigFile('{"apiUrl":"http://a","token":"t","kubeContext":"k","extra":1,"bad":2}', '/cfg.json');
    expect(values).toEqual({ apiUrl: 'http://a', token: 't', kubeContext: 'k' });
  });

  test('非字符串的值当作没写', () => {
    expect(parseConfigFile('{"apiUrl":123,"token":null}', '/cfg.json')).toEqual({});
  });

  test('坏 JSON 报路径与问题，且不回显文件内容', () => {
    let failure: CliFailure | undefined;
    try {
      parseConfigFile('{"token":"super-secret"', '/cfg.json');
    } catch (error) {
      failure = error instanceof CliFailure ? error : undefined;
    }
    expect(failure?.message).toContain('/cfg.json');
    expect([failure?.message, ...(failure?.detail ?? [])].join('\n')).not.toContain('super-secret');
  });

  test('顶层不是对象也报错', () => {
    expect(() => parseConfigFile('[1,2]', '/cfg.json')).toThrow(CliFailure);
  });
});

describe('令牌只进请求头', () => {
  test('缺令牌是用法错误，提示里没有取值', () => {
    expect(() => requireToken(resolveSettings(base))).toThrow('没有配置平台令牌');
  });

  test('令牌作为平台会话 Cookie 发出', async () => {
    const fetcher = fakeFetch(() => jsonResponse(200, { items: [] }));
    const settings = resolveSettings({ ...base, flags: { api: 'http://console.example', token: 'secret-token' } });
    await createPlatformClient(settings, fetcher.fetchImpl).projects.list();
    expect(fetcher.calls[0]?.url).toBe('http://console.example/v1/projects');
    expect(fetcher.calls[0]?.headers.get('cookie')).toBe(`${SESSION_COOKIE_NAME}=secret-token`);
  });

  test('API 地址不是 URL 时是用法错误', () => {
    const settings = resolveSettings({ ...base, flags: { api: 'not a url', token: 't' } });
    expect(() => createPlatformClient(settings, fakeFetch(() => jsonResponse(200, {})).fetchImpl)).toThrow('不是合法 URL');
  });
});
