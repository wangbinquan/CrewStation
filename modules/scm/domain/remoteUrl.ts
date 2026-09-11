export interface UrlCredential {
  readonly username: string;
  readonly password: string;
}

/** 把凭据放进 HTTP 地址的 userinfo 段；GitLab 对令牌只看密码位，用户名任意非空。 */
export function withCredential(httpUrl: string, username: string, secret: string): string {
  const url = new URL(httpUrl);
  url.username = username;
  url.password = secret;
  return url.toString();
}

/** 供调用方以明文替换 `{token}` 的模板；不能用 URL 对象拼，否则花括号会被转义。 */
export function credentialTemplate(httpUrl: string, username: string): string {
  const url = new URL(httpUrl);
  return `${url.protocol}//${username}:{token}@${url.host}${url.pathname}`;
}

/** 把 userinfo 从地址里拆出来：地址可以上命令行，凭据只能走环境变量。 */
export function splitCredential(urlWithCredential: string): { url: string; credential?: UrlCredential } {
  const url = new URL(urlWithCredential);
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  url.username = '';
  url.password = '';
  return { url: url.toString(), ...(username || password ? { credential: { username, password } } : {}) };
}

/** 任何可能进入日志或错误消息的文本先经过它。 */
export function scrubCredential(text: string, credential?: UrlCredential): string {
  if (!credential) return text;
  let out = text;
  for (const secret of new Set([credential.password, encodeURIComponent(credential.password)])) {
    if (secret) out = out.split(secret).join('***');
  }
  return out;
}

/** 平台代推时的用户名：GitLab 只校验密码位的令牌，用户名仅用于日志可读。 */
export const PLATFORM_PUSH_USERNAME = 'crewstation';
export const DEFAULT_CREDENTIAL_USERNAME = 'cs-session';
