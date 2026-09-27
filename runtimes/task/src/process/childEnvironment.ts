/** 绝不能进入任何子进程的环境变量：runner 令牌与 cs-session 地址。 */
const STRIPPED_EXACT = new Set(['CS_RUNNER_TOKEN', 'CS_SESSION_URL']);
const STRIPPED_PREFIXES = ['CS_RUNNER_', 'CS_RUNTIME_'];

export interface ChildEnvOptions {
  /** 降权时子进程的 HOME（worker 的家目录）；未降权时沿用父进程的 HOME。 */
  home?: string;
  extra?: Record<string, string>;
}

/** 子进程基础环境：复制父进程环境、剔除 runner 私有变量、可选覆盖 HOME，再叠加调用方追加的键值。 */
export function buildChildEnv(base: Record<string, string | undefined>, options: ChildEnvOptions = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || STRIPPED_EXACT.has(key) || STRIPPED_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  if (options.home !== undefined) {
    env.HOME = options.home;
    env.USER = 'worker';
    env.LOGNAME = 'worker';
  }
  return { ...env, ...options.extra };
}
