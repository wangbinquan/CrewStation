import { PlatformError } from '@crewstation/kernel';

export interface GitLabErrorContext {
  readonly method: string;
  readonly path: string;
}

const CONFLICT_HINTS = [/has already been taken/i, /already exists/i, /already protected/i];

/**
 * HTTP 状态到平台错误分类：404→not_found；409 或 400／422 且提示“已存在”→conflict；401／403→forbidden；
 * 其他 400／422→validation；其余（含 5xx、429）→unavailable。GitLab 的原始提示放进 message 与 details.gitlab。
 */
export function mapGitLabError(status: number, body: string, context: GitLabErrorContext): PlatformError {
  const gitlab = extractMessage(body);
  const details = { status, method: context.method, path: context.path, gitlab };
  const text = `GitLab ${context.method} ${context.path} 返回 ${status}：${gitlab}`;
  if (status === 404) return new PlatformError('not_found', text, details);
  if (status === 409 || ((status === 400 || status === 422) && CONFLICT_HINTS.some((re) => re.test(gitlab)))) {
    return new PlatformError('conflict', text, details);
  }
  if (status === 401 || status === 403) return new PlatformError('forbidden', text, details);
  if (status === 400 || status === 422) return new PlatformError('validation', text, details);
  return new PlatformError('unavailable', text, details);
}

/** GitLab 的错误体有三种形态：`{message: string}`、`{message: {field: [..]}}`、`{error: string}`；统一压成一行。 */
export function extractMessage(body: string): string {
  if (!body) return '';
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown };
    const source = parsed.message ?? parsed.error;
    if (typeof source === 'string') return source;
    if (source && typeof source === 'object') {
      return Object.entries(source as Record<string, unknown>)
        .map(([field, issues]) => `${field} ${Array.isArray(issues) ? issues.join(', ') : String(issues)}`)
        .join('; ');
    }
    return body.slice(0, 500);
  } catch {
    return body.slice(0, 500);
  }
}

/** 任何可能进入日志或错误消息的文本都先经过它；令牌为空时原样返回。 */
export function redactSecret(text: string, secret: string): string {
  return secret ? text.split(secret).join('***') : text;
}
