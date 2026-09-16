import type { TaskId } from '@crewstation/contracts';
import { NativeTerminalRosterSchema, PLATFORM_ENV, TaskIdSchema } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';

export interface PreviewConfig {
  command: string[];
  port: number;
  healthPath: string;
}

export type TerminalBackendChoice = 'auto' | 'native' | 'script';

export interface RunnerConfig {
  taskId: TaskId;
  nativeRunnerId?: string;
  runnerToken: string;
  sessionUrl: string;
  internalApiBase?: string;
  workdir: string;
  workerUid: number;
  workerGid: number;
  preview?: PreviewConfig;
  /** root 专属 0600 文件，`KEY=VALUE` 行；只注入部署配置模式的 Agent 进程（模型凭据）。 */
  agentEnvFile?: string;
  /** 托管 Agent 私有目录的根（RFC-004）；缺省 <tmpdir>/crewstation-agents，测试注入临时目录。 */
  agentRunDir?: string;
  terminalBackend: TerminalBackendChoice;
  replayCapacity: number;
  /** 超过该时长没有收到 cs-session 的任何帧（含 ping）即主动重连；0 表示关闭看门狗。 */
  idleTimeoutMs: number;
  reconnect: { baseMs: number; maxMs: number };
  previewPolicy: { maxRestarts: number; baseDelayMs: number; pollIntervalMs: number; probeTimeoutMs: number };
  logger?: Logger;
}

export const DEFAULT_WORKER_ID = 10001;

export class RunnerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunnerConfigError';
  }
}

type Env = Record<string, string | undefined>;

export function loadConfigFromEnv(env: Env = process.env): RunnerConfig {
  const taskId = TaskIdSchema.safeParse(env.CS_RUNNER_TASK_ID ?? required(env, 'CS_TASK_ID'));
  if (!taskId.success) throw new RunnerConfigError('CS_TASK_ID 不是合法的任务 ID（tsk_<32 位十六进制>）');
  return {
    taskId: taskId.data,
    ...(env.CS_RUNNER_NATIVE_ID ? { nativeRunnerId: NativeTerminalRosterSchema.shape.runnerId.parse(env.CS_RUNNER_NATIVE_ID) } : {}),
    runnerToken: required(env, 'CS_RUNNER_TOKEN'),
    sessionUrl: required(env, 'CS_SESSION_URL'),
    internalApiBase: env[PLATFORM_ENV.internalApiBase] || undefined,
    workdir: env.CS_WORKDIR || '/work',
    workerUid: integer(env, 'CS_WORKER_UID', DEFAULT_WORKER_ID),
    workerGid: integer(env, 'CS_WORKER_GID', DEFAULT_WORKER_ID),
    preview: parsePreview(env),
    agentEnvFile: env.CS_AGENT_ENV_FILE || undefined,
    terminalBackend: parseTerminalBackend(env.CS_TERMINAL_BACKEND),
    replayCapacity: 5000,
    idleTimeoutMs: 90_000,
    reconnect: { baseMs: 500, maxMs: 30_000 },
    previewPolicy: { maxRestarts: 5, baseDelayMs: 1000, pollIntervalMs: 500, probeTimeoutMs: 2000 },
  };
}

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new RunnerConfigError(`缺少环境变量 ${name}`);
  return value;
}

function integer(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new RunnerConfigError(`${name} 必须是非负整数，实际 ${raw}`);
  return value;
}

function parsePreview(env: Env): PreviewConfig | undefined {
  const raw = env.CS_PREVIEW_COMMAND;
  if (!raw) return undefined;
  let command: unknown;
  try {
    command = JSON.parse(raw);
  } catch {
    throw new RunnerConfigError('CS_PREVIEW_COMMAND 必须是 JSON 字符串数组');
  }
  if (!Array.isArray(command) || command.length === 0 || !command.every((c) => typeof c === 'string' && c.length > 0)) {
    throw new RunnerConfigError('CS_PREVIEW_COMMAND 必须是非空的 JSON 字符串数组');
  }
  const port = Number(env.CS_PREVIEW_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RunnerConfigError('设置了 CS_PREVIEW_COMMAND 时 CS_PREVIEW_PORT 必须是 1–65535 的端口号');
  const healthPath = env.CS_PREVIEW_HEALTH_PATH || '/';
  if (!healthPath.startsWith('/')) throw new RunnerConfigError('CS_PREVIEW_HEALTH_PATH 必须以 / 开头');
  return { command: command as string[], port, healthPath };
}

function parseTerminalBackend(raw: string | undefined): TerminalBackendChoice {
  if (raw === undefined || raw === '' || raw === 'auto') return 'auto';
  if (raw === 'native' || raw === 'script') return raw;
  throw new RunnerConfigError(`CS_TERMINAL_BACKEND 只接受 auto、native、script，实际 ${raw}`);
}
