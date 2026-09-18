import type { AgentProtocol, RunnerHello } from '@crewstation/contracts';
import { TASKRUNNER_PROTOCOL_VERSION } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import { createJsonLogger } from '@crewstation/kernel';
import type { AgentSupervisor } from './agents/agentSupervisor';
import { createAgentSupervisor } from './agents/agentSupervisor';
import { createCliDriverFactory } from './agents/cliDriver';
import type { AgentDriverFactory } from './agents/driver';
import type { TerminalProbes } from './agents/terminalProbe';
import { createTerminalProbes } from './agents/terminalProbe';
import type { CommandDispatcher } from './commandDispatcher';
import { createCommandDispatcher } from './commandDispatcher';
import { buildCommandHandlers } from './commandHandlers';
import type { RunnerConfig } from './config';
import { createContractVerifier } from './contract/verifyContract';
import type { ExecSupervisor } from './exec/execSupervisor';
import { createExecSupervisor } from './exec/execSupervisor';
import { createFileCommands } from './files/fileCommands';
import type { WorkdirPaths } from './files/workdirPath';
import { createWorkdirPaths } from './files/workdirPath';
import type { PreviewSupervisor } from './preview/previewSupervisor';
import { createPreviewSupervisor } from './preview/previewSupervisor';
import type { ProcessLauncher } from './process/launcher';
import { createProcessLauncher } from './process/launcher';
import { probeCurrentUid, resolveIsolation } from './process/privilege';
import type { SessionLink } from './sessionLink';
import { createSessionLink } from './sessionLink';
import type { TerminalSupervisor } from './terminal/terminalSupervisor';
import { createTerminalSupervisor } from './terminal/terminalSupervisor';
import { NativeTerminalSupervisor } from './terminal/nativeSupervisor';
import { createGitCommand } from './workspace/gitCommand';
import { readWorkspaceStatus } from './workspace/workspaceStatus';
import { createWorkspaceComparisons } from './workspace/workspaceComparison';
import { fetchComparisonHistory } from './workspace/fetchComparisonHistory';
import { createApiInvoker } from './http/apiInvocation';
import { BeforeStartRunner } from './beforeStart/beforeStartRunner';
import { detectInterpreters } from './beforeStart/interpreters';

export interface RunnerHooks {
  /** shutdown 排空完成后调用；缺省 process.exit。测试注入以免真的退出。 */
  exit?: (code: number) => void;
  /** 测试注入驱动工厂（按档位协议取驱动）；缺省两种已知协议的 CLI 驱动。 */
  drivers?: AgentDriverFactory;
}

/** hello 宣告的是本 Runner 代码理解的协议；二进制在不在、能不能起由档位测试证明（RFC-006 §4.2）。 */
export const RUNNER_PROTOCOLS: readonly AgentProtocol[] = ['claude-code', 'opencode', 'terminal'];

export interface RunnerHandle {
  /** 排空并释放全部子进程与连接，不调用 exit。 */
  stop(): Promise<void>;
  /** 协议 shutdown 语义：runnerState draining → 取消 Agent、关终端、停预览 → 在 graceSeconds 内 exit(0)。 */
  shutdown(graceSeconds?: number): Promise<void>;
  /** 首次 welcome。 */
  whenConnected(): Promise<void>;
  readonly link: SessionLink;
  readonly workdir: string;
}

export async function startRunner(config: RunnerConfig, hooks: RunnerHooks = {}): Promise<RunnerHandle> {
  const logger = config.logger ?? createJsonLogger({ service: 'taskrunner', taskId: config.taskId });
  const runner = await TaskRunner.create(config, hooks, logger);
  runner.start();
  return runner;
}

class TaskRunner implements RunnerHandle {
  private shuttingDown: Promise<void> | undefined;

  private constructor(
    private readonly config: RunnerConfig,
    private readonly hooks: RunnerHooks,
    private readonly logger: Logger,
    private readonly paths: WorkdirPaths,
    private readonly launcher: ProcessLauncher,
    readonly link: SessionLink,
    private readonly dispatcher: CommandDispatcher,
    private readonly agents: AgentSupervisor,
    private readonly probes: TerminalProbes,
    private readonly execs: ExecSupervisor,
    private readonly terminals: TerminalSupervisor,
    private readonly nativeTerminals: NativeTerminalSupervisor,
    private readonly preview: PreviewSupervisor,
  ) {}

  static async create(config: RunnerConfig, hooks: RunnerHooks, logger: Logger): Promise<TaskRunner> {
    const paths = await createWorkdirPaths(config.workdir);
    const isolation = resolveIsolation({ uid: config.workerUid, gid: config.workerGid, currentUid: probeCurrentUid(), which: (b) => Bun.which(b) });
    if (isolation.enabled) logger.info('privilege drop enabled: children run via setpriv', { uid: isolation.uid, gid: isolation.gid });
    else logger.warn('privilege drop disabled: children run as the runner user', { reason: isolation.reason });
    const launcher = createProcessLauncher({ isolation, processEnv: process.env, workerHome: paths.root, logger });
    const drivers = hooks.drivers ?? createCliDriverFactory();
    const linkRef: { current?: SessionLink } = {};
    const emit = (event: Parameters<SessionLink['emit']>[0]): void => {
      linkRef.current?.emit(event);
    };
    // 启动前 Hook（RFC-004，RFC-006 起每次启动都经它）：解释器清单启动时探测一次并写进 hello；执行器同一容器串行。
    const interpreters = await detectInterpreters(launcher, (b) => Bun.which(b));
    const beforeStart = new BeforeStartRunner({ launcher, interpreters, emit, logger: logger.child({ component: 'before-start' }), ...(config.agentRunDir ? { baseDir: config.agentRunDir } : {}) });
    logger.info('before-start interpreters detected', { interpreters: interpreters.list.map((i) => `${i.language}=${i.version ?? '?'}`) });
    const agents = createAgentSupervisor({ drivers, launcher, paths, beforeStart, emit, logger: logger.child({ component: 'agents' }) });
    const probes = createTerminalProbes({ beforeStart, launcher, paths, logger: logger.child({ component: 'probe' }) });
    const execs = createExecSupervisor({ launcher, paths, emit, logger: logger.child({ component: 'exec' }) });
    const terminals = createTerminalSupervisor({ choice: config.terminalBackend, launcher, paths, emit, logger: logger.child({ component: 'terminal' }) });
    const nativeTerminals = new NativeTerminalSupervisor({ backend: terminals.backend, launcher, paths, beforeStart, emit, runnerId: config.nativeRunnerId, logger: logger.child({ component: 'native-terminal' }) });
    const preview = createPreviewSupervisor({ config: config.preview, policy: config.previewPolicy, launcher, workdir: paths.root, emit, logger: logger.child({ component: 'preview' }) });
    const files = createFileCommands({ paths, launcher, emit, logger: logger.child({ component: 'files' }) });
    const verifyContract = createContractVerifier({ paths, logger: logger.child({ component: 'contract' }) });
    const git = createGitCommand(execs);
    const comparisons = createWorkspaceComparisons({ git, paths, launcher });
    const apiInvoker = createApiInvoker(config.internalApiBase);
    const runnerRef: { current?: TaskRunner } = {};
    const handlers = buildCommandHandlers({ agents, probes, execs, terminals, nativeTerminals, files, preview, verifyContract, invokeApi: apiInvoker.invoke, workspaceStatus: () => readWorkspaceStatus(git, paths), comparisons, fetchComparisonHistory: (url, sha) => fetchComparisonHistory(git, url, sha), requestShutdown: (grace) => void runnerRef.current?.shutdown(grace) });
    const hello = (): RunnerHello => ({
      type: 'hello',
      protocolVersion: TASKRUNNER_PROTOCOL_VERSION,
      taskId: config.taskId,
      runnerToken: config.runnerToken,
      workdir: paths.root,
      capabilities: { protocols: [...RUNNER_PROTOCOLS], pty: terminals.backend !== undefined, preview: preview.enabled, ...(apiInvoker.enabled ? { apiInvocations: 1 as const } : {}), interpreters: interpreters.list },
    });
    const dispatcherRef: { current?: CommandDispatcher } = {};
    const link = createSessionLink({
      url: config.sessionUrl,
      hello,
      replayCapacity: config.replayCapacity,
      idleTimeoutMs: config.idleTimeoutMs,
      backoff: { baseMs: config.reconnect.baseMs, maxMs: config.reconnect.maxMs },
      onCommand: (command) => void dispatcherRef.current?.dispatch(command),
      logger: logger.child({ component: 'link' }),
    });
    linkRef.current = link;
    const dispatcher = createCommandDispatcher(handlers, link, logger.child({ component: 'dispatch' }));
    dispatcherRef.current = dispatcher;
    const runner = new TaskRunner(config, hooks, logger, paths, launcher, link, dispatcher, agents, probes, execs, terminals, nativeTerminals, preview);
    runnerRef.current = runner;
    return runner;
  }

  get workdir(): string {
    return this.paths.root;
  }

  start(): void {
    this.logger.info('taskrunner starting', { workdir: this.paths.root, sessionUrl: this.config.sessionUrl, preview: this.preview.enabled, isolated: this.launcher.isolation.enabled });
    this.link.emit({ kind: 'runnerState', state: 'ready' });
    this.preview.start();
    this.link.start();
  }

  whenConnected(): Promise<void> {
    return this.link.whenReady();
  }

  async stop(): Promise<void> {
    this.shuttingDown ??= this.drain();
    await this.shuttingDown;
  }

  async shutdown(graceSeconds = 30): Promise<void> {
    const deadline = Bun.sleep(Math.max(0, graceSeconds) * 1000).then(() => 'timeout' as const);
    const outcome = await Promise.race([this.stop().then(() => 'drained' as const), deadline]);
    if (outcome === 'timeout') this.logger.error('shutdown grace exceeded, exiting anyway', { graceSeconds });
    this.link.emit({ kind: 'runnerState', state: 'shutting-down' });
    if (!(await this.link.flush())) this.logger.warn('shutdown flush timed out, tail events may be lost');
    this.link.close();
    (this.hooks.exit ?? ((code: number) => process.exit(code)))(0);
  }

  private async drain(): Promise<void> {
    this.logger.info('draining', { agents: this.agents.size, execs: this.execs.size, terminals: this.terminals.size });
    this.link.emit({ kind: 'runnerState', state: 'draining' });
    this.dispatcher.refuseNew();
    this.probes.cancelAll();
    await Promise.allSettled([this.agents.cancelAll(), this.terminals.closeAll(), this.nativeTerminals.closeAll(), this.execs.cancelAll(), this.preview.stop()]);
    await this.dispatcher.drain();
    this.logger.info('drained');
  }
}
