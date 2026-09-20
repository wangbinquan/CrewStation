import { chmod, chown, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TaskId } from '@crewstation/contracts';
import { createJsonLogger } from '@crewstation/kernel';
import type { RunnerConfig } from '../src/config';
import type { RunnerHandle, RunnerHooks } from '../src/runner';
import { startRunner } from '../src/runner';

export const TEST_TASK_ID = '01a0bf5d-8f4b-7418-8a3f-7cbb4a1fd751' as TaskId;
export const TEST_SUBTASK_ID = '01a0bf5d-8f4b-7144-8d23-43f7e15387c2';
export const TEST_TOKEN = 'runner-token-SECRET-do-not-log';
export const WORKER_ID = 10001;

export interface TestRunner {
  runner: RunnerHandle;
  workdir: string;
  config: RunnerConfig;
  /** JSON 日志行，供断言“绝不记录令牌与值”。 */
  logLines: string[];
  exitCodes: number[];
  dispose(): Promise<void>;
}

export const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

/** 在临时工作目录里以进程内方式启动 runner；root（容器内）时把目录交给 worker，非 root 直接用。 */
export async function startTestRunner(sessionUrl: string, overrides: Partial<RunnerConfig> = {}, hooks: RunnerHooks = {}): Promise<TestRunner> {
  const workdir = await mkdtemp(join(tmpdir(), 'cs-runner-'));
  if (runningAsRoot) await chown(workdir, WORKER_ID, WORKER_ID);
  // 每次启动的私有目录（启动前 Hook）放进本次测试自己的临时根，不落到共享的 <tmpdir>/crewstation-agents。
  const agentRunRoot = await mkdtemp(join(tmpdir(), 'cs-runner-agents-'));
  // mkdtemp 是 root 独占的 0700：降权后的 CLI 与脚本要能穿过它走到自己的私有目录。
  if (runningAsRoot) await chmod(agentRunRoot, 0o755);
  const logLines: string[] = [];
  const exitCodes: number[] = [];
  const config: RunnerConfig = {
    taskId: TEST_TASK_ID,
    runnerToken: TEST_TOKEN,
    sessionUrl,
    workdir,
    workerUid: WORKER_ID,
    workerGid: WORKER_ID,
    terminalBackend: 'auto',
    replayCapacity: 200,
    idleTimeoutMs: 0,
    reconnect: { baseMs: 20, maxMs: 60 },
    previewPolicy: { maxRestarts: 5, baseDelayMs: 20, pollIntervalMs: 50, probeTimeoutMs: 1000 },
    logger: createJsonLogger({ service: 'taskrunner-test' }, (line) => logLines.push(line)),
    agentRunDir: join(agentRunRoot, 'agents'),
    ...overrides,
  };
  const runner = await startRunner(config, { exit: (code) => exitCodes.push(code), ...hooks });
  return {
    runner,
    workdir,
    config,
    logLines,
    exitCodes,
    async dispose() {
      await runner.stop();
      runner.link.close();
      await rm(workdir, { recursive: true, force: true });
      await rm(agentRunRoot, { recursive: true, force: true });
    },
  };
}

/** 借一个空闲端口（起一个临时服务再关掉）。 */
export function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response('') });
  const port = probe.port ?? 0;
  probe.stop(true);
  return port;
}
