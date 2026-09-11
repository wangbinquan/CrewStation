import type { ApiClient, FetchLike } from '@crewstation/api-client';
import { createApiClient } from '@crewstation/api-client';
import { UsageError } from './cliError';
import { SETTING_KEYS } from './settings';
import type { CliSettings } from './settings';

/** 网关用户域 ForwardAuth 读的平台会话 Cookie 名（modules/identity domain/session.ts）。 */
export const SESSION_COOKIE_NAME = 'cs_session';

/**
 * CLI 与工作台走同一条用户域链路：网关先 ForwardAuth 再转 cs-api，因此凭据必须是平台会话令牌。
 * Design §7 还没有为 CLI 定义独立的令牌端点，这里就把配置里的令牌当会话令牌送出；
 * 将来有了 CLI 令牌，只改这一个函数。令牌只出现在这里，任何输出路径都拿不到它。
 */
export function createPlatformClient(settings: CliSettings, fetchImpl: FetchLike): ApiClient {
  const token = requireToken(settings);
  return createApiClient({
    baseUrl: normalizeBaseUrl(settings.apiUrl),
    fetch: fetchImpl,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });
}

export function requireToken(settings: CliSettings): string {
  if (settings.token !== undefined && settings.token.length > 0) return settings.token;
  const key = SETTING_KEYS.find((item) => item.name === 'token');
  throw new UsageError('没有配置平台令牌', [
    `  按顺序取第一个有值的：--${key?.flag ?? 'token'} <token>、环境变量 ${key?.env ?? 'CS_TOKEN'}、配置文件 ${settings.configFilePath} 的 token 字段`,
    '  令牌来自工作台登录后的平台会话；CLI 不会把它打印出来',
  ].join('\n'));
}

/** 末尾斜杠交给 buildUrl 处理即可，这里只拒绝明显不是地址的取值。 */
export function normalizeBaseUrl(raw: string): string {
  try {
    return new URL(raw).toString().replace(/\/$/, '');
  } catch {
    throw new UsageError(`平台 API 地址不是合法 URL：${raw}`, '  形如 http://console.cs.localhost');
  }
}
