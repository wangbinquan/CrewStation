import type { AgentSupervisor } from './agents/agentSupervisor';
import type { CommandHandlers } from './commandDispatcher';
import type { ContractVerifier } from './contract/verifyContract';
import type { ExecSupervisor } from './exec/execSupervisor';
import type { FileCommands } from './files/fileCommands';
import type { PreviewSupervisor } from './preview/previewSupervisor';
import type { TerminalSupervisor } from './terminal/terminalSupervisor';
import type { NativeTerminalSupervisor } from './terminal/nativeSupervisor';
import type { ApiInvocationResult, RunnerApiInvocation, RunnerWorkspaceStatus } from '@crewstation/contracts';
import type { WorkspaceComparisons } from './workspace/workspaceComparison';

export interface CommandTargets {
  invokeApi: (input: RunnerApiInvocation) => Promise<ApiInvocationResult>;
  agents: AgentSupervisor;
  execs: ExecSupervisor;
  terminals: TerminalSupervisor;
  nativeTerminals: NativeTerminalSupervisor;
  files: FileCommands;
  preview: PreviewSupervisor;
  verifyContract: ContractVerifier;
  workspaceStatus: () => Promise<RunnerWorkspaceStatus>;
  comparisons: WorkspaceComparisons;
  fetchComparisonHistory: (url: string, targetSha?: string) => Promise<void>;
  /** 先回 ack，再异步进入排空；由 runner 实现。 */
  requestShutdown: (graceSeconds: number) => void;
}

const ack = (): Record<string, never> => ({});

/** 协议命令 → 各监督器；无内容的命令统一回 `{}`（RunnerResultPayloads.ack）。 */
export function buildCommandHandlers(targets: CommandTargets): CommandHandlers {
  return {
    invokeApi: ({ id: _id, type: _type, ...input }) => targets.invokeApi(input),
    startAgentTerminal: (c) => targets.nativeTerminals.start(c),
    listAgentTerminals: async () => targets.nativeTerminals.list(),
    stopAgentTerminal: (c) => targets.nativeTerminals.stop(c.agentId, c.runnerId).then(ack),
    attachTerminal: (c) => targets.nativeTerminals.attach(c.terminalId, c.runnerId),
    claimTerminalControl: async (c) => targets.nativeTerminals.claim(c.terminalId, c.viewId, c.runnerId),
    detachTerminal: async (c) => { targets.nativeTerminals.detach(c.terminalId, c.viewId); return ack(); },
    startAgent: (c) => targets.agents.start(c).then(ack),
    sendMessage: (c) => targets.agents.send(c.agentId, c.content).then(ack),
    cancelAgent: (c) => targets.agents.cancel(c.agentId).then(ack),
    exec: (c) => targets.execs.run(c),
    cancelExec: (c) => targets.execs.cancel(c.execId).then(ack),
    openTerminal: (c) => targets.terminals.open(c).then(ack),
    terminalInput: async (c) => { if (targets.nativeTerminals.has(c.terminalId)) targets.nativeTerminals.input(c.terminalId, c.data, c.viewId); else await targets.terminals.input(c); return ack(); },
    terminalResize: async (c) => { if (targets.nativeTerminals.has(c.terminalId)) await targets.nativeTerminals.resize(c.terminalId, c.cols, c.rows, c.viewId); else await targets.terminals.resize(c); return ack(); },
    closeTerminal: async (c) => { if (!targets.nativeTerminals.has(c.terminalId)) await targets.terminals.close(c); return ack(); },
    listFiles: (c) => targets.files.list(c),
    readFile: (c) => targets.files.read(c),
    writeFile: (c) => targets.files.write(c),
    workspaceStatus: () => targets.workspaceStatus(),
    compareWorkspace: (c) => targets.comparisons.compare(c.targetSha),
    workspaceComparisonDetails: (c) => targets.comparisons.details(c.comparisonId, c),
    fetchComparisonHistory: (c) => targets.fetchComparisonHistory(c.url, c.targetSha).then(ack),
    previewStatus: async () => targets.preview.status(),
    restartPreview: () => targets.preview.restart().then(ack),
    verifyContract: (c) => targets.verifyContract(c),
    shutdown: async (c) => {
      targets.requestShutdown(c.graceSeconds);
      return ack();
    },
  };
}
