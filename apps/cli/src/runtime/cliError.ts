import { isApiClientError } from '@crewstation/api-client';

/** 只有三种退出码，错误类型与它们一一对应；命令抛出哪种错误就决定进程退出码。 */
export const EXIT = { ok: 0, failure: 1, usage: 2 } as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** 命令行用错了：未知命令、缺位置参数、标志取值非法、缺少必需的配置项。退出码 2。 */
export class UsageError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'UsageError';
    this.hint = hint;
  }
}

/** 平台或集群侧的可处理失败：原样转述服务端消息，附上可操作的细节。退出码 1。 */
export class CliFailure extends Error {
  readonly detail: readonly string[];

  constructor(message: string, detail: readonly string[] = []) {
    super(message);
    this.name = 'CliFailure';
    this.detail = detail;
  }
}

export function exitCodeFor(error: unknown): ExitCode {
  return error instanceof UsageError ? EXIT.usage : EXIT.failure;
}

/** 错误 → 写到 stderr 的若干行；只转述服务端与本地消息，绝不回显令牌等配置值。 */
export function errorLines(error: unknown): string[] {
  if (error instanceof UsageError) return ['用法错误：' + error.message, ...(error.hint ? [error.hint] : [])];
  if (error instanceof CliFailure) return ['错误：' + error.message, ...error.detail];
  if (isApiClientError(error)) return apiErrorLines(error.message, error.status, error.kind, error.details);
  return ['错误：' + (error instanceof Error ? error.message : String(error))];
}

/** 服务端错误体：第一行是服务端消息，其后按已知的 details 形状补可操作信息。 */
function apiErrorLines(message: string, status: number, kind: string, details: Readonly<Record<string, unknown>>): string[] {
  const lines = ['错误：' + message, status === 0 ? '  连接失败；检查 --api 地址、网络与出站代理' : `  HTTP ${status}｜${kind}`];
  lines.push(...uncommittedLines(details));
  const reason = details.reason;
  if (typeof reason === 'string' && reason.length > 0) lines.push('  原因：' + reason);
  return lines;
}

/** 发布前检查失败（412）：Design §6.2 要求列出未提交的文件，平台放在 details.uncommitted。 */
function uncommittedLines(details: Readonly<Record<string, unknown>>): string[] {
  const raw = details.uncommitted;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const paths = raw.filter((item): item is string => typeof item === 'string');
  return [`  未提交的文件（${paths.length} 个）：`, ...paths.map((path) => '    ' + path), '  先提交或撤销这些改动再发布；平台不代为 git add，也不会打标签'];
}
