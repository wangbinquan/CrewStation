import type { AgentEvent, KnownAgentProtocol } from '@crewstation/contracts';
import type { CliAgentDriver, DriverAgentSpec, DriverLaunchContext, ProcessHost } from '@crewstation/agent-drivers';
import { DriverStateError, createClaudeCodeDriver, createOpencodeDriver } from '@crewstation/agent-drivers';
import { RunnerCommandError } from '../commandError';
import type { ProcessLauncher } from '../process/launcher';
import { killProcessTree } from '../process/processTree';
import { createLineSplitter, pumpStream } from '../process/streamPump';
import type { AgentDriver, AgentDriverFactory, AgentLaunchContext, AgentProcess, AgentSpec } from './driver';

export interface CliDriverOptions {
  /** 测试钩子；缺省 Bun.which（对档位给出的绝对路径判断是否可执行）。 */
  which?: (binary: string) => string | null;
}

/**
 * 两个 CLI 驱动的接线点：真实实现（argv／env 装配、stream-json 解析、权限映射、MCP 注入、
 * 会话恢复）在 `@crewstation/agent-drivers`，这里只把宿主能力注入给它——
 * 所有子进程仍经 ProcessLauncher 降权拉起，杀树与按行泵送复用本运行时的 processTree／streamPump。
 * RFC-006：驱动只按协议区分，二进制与参数随每次启动的 launch 下发，不再按 PATH 探测、按名字注册。
 */
export function createClaudeCodeCliDriver(options: CliDriverOptions = {}): AgentDriver {
  return adapt(createClaudeCodeDriver(options.which ?? defaultWhich));
}

export function createOpencodeCliDriver(options: CliDriverOptions = {}): AgentDriver {
  return adapt(createOpencodeDriver(options.which ?? defaultWhich));
}

/** 缺省驱动工厂：两种已知协议各一个驱动；通用终端协议没有 headless 驱动，只进「＋ CLI」（C6）。 */
export function createCliDriverFactory(options: CliDriverOptions = {}): AgentDriverFactory {
  const drivers: Record<KnownAgentProtocol, AgentDriver> = { 'claude-code': createClaudeCodeCliDriver(options), opencode: createOpencodeCliDriver(options) };
  return { forProtocol: (protocol) => drivers[protocol] };
}

const defaultWhich = (binary: string): string | null => Bun.which(binary);

function adapt(driver: CliAgentDriver): AgentDriver {
  return {
    protocol: driver.protocol,
    start: (spec, context) => wrap(driver, spec, context),
  };
}

function wrap(driver: CliAgentDriver, spec: AgentSpec, context: AgentLaunchContext): AgentProcess {
  const process = driver.start(toDriverSpec(spec), toDriverContext(context));
  return {
    events: process.events as AsyncIterable<AgentEvent>,
    send: (text) => process.send(text).catch(rethrow),
    cancel: () => process.cancel().catch(rethrow),
  };
}

/** 驱动的状态错误带的是协议级 code，原样转成 RunnerCommandError。 */
function rethrow(error: unknown): never {
  if (error instanceof DriverStateError) throw new RunnerCommandError(error.code, error.message);
  throw error;
}

function toDriverSpec(spec: AgentSpec): DriverAgentSpec {
  return {
    agentId: spec.agentId,
    compute: spec.compute,
    profileRevision: spec.profileRevision,
    launch: spec.launch,
    permission: spec.permission,
    mode: spec.mode,
    ...(spec.initialPrompt === undefined ? {} : { initialPrompt: spec.initialPrompt }),
    ...(spec.resumeSessionId === undefined ? {} : { resumeSessionId: spec.resumeSessionId }),
    ...(spec.systemPrompt === undefined ? {} : { systemPrompt: spec.systemPrompt }),
    mcp: spec.mcp,
  };
}

function toDriverContext(context: AgentLaunchContext): DriverLaunchContext {
  return { cwd: context.cwd, env: context.env, logger: context.logger, host: createProcessHost(context.launcher), managed: context.managed, runDir: context.managed.runDir };
}

/** 把 ProcessLauncher 与本运行时的进程／流工具包成驱动包声明的 ProcessHost 端口。 */
export function createProcessHost(launcher: ProcessLauncher): ProcessHost {
  return {
    spawnPiped: (spec) => launcher.spawnPiped(spec),
    spawnWithStdin: (spec) => launcher.spawnWithStdin(spec),
    // 断言成立的依据：交回来的句柄就是上面两个方法返回的 Bun Subprocess 本身，驱动只读了它的结构子集。
    killTree: (child, graceMs) => killProcessTree(child as Parameters<typeof killProcessTree>[0], graceMs),
    pumpLines: async (stream, onLine) => {
      const splitter = createLineSplitter(onLine);
      await pumpStream(stream, (text) => splitter.push(text));
      splitter.flush();
    },
    chownToWorker: (path) => launcher.chownToWorker(path),
    which: (binary) => Bun.which(binary),
  };
}
