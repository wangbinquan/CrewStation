import type { AgentSupervisor } from './agents/agentSupervisor';
import type { CommandHandlers } from './commandDispatcher';
import type { ContractVerifier } from './contract/verifyContract';
import type { ExecSupervisor } from './exec/execSupervisor';
import type { FileCommands } from './files/fileCommands';
import type { PreviewSupervisor } from './preview/previewSupervisor';
import type { TerminalSupervisor } from './terminal/terminalSupervisor';
import type { RunnerWorkspaceStatus } from '@crewstation/contracts';
import type { WorkspaceComparisons } from './workspace/workspaceComparison';

export interface CommandTargets {
  agents: AgentSupervisor;
  execs: ExecSupervisor;
  terminals: TerminalSupervisor;
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
    startAgent: (c) => targets.agents.start(c).then(ack),
    sendMessage: (c) => targets.agents.send(c.agentId, c.content).then(ack),
    cancelAgent: (c) => targets.agents.cancel(c.agentId).then(ack),
    exec: (c) => targets.execs.run(c),
    cancelExec: (c) => targets.execs.cancel(c.execId).then(ack),
    openTerminal: (c) => targets.terminals.open(c).then(ack),
    terminalInput: (c) => targets.terminals.input(c).then(ack),
    terminalResize: (c) => targets.terminals.resize(c).then(ack),
    closeTerminal: (c) => targets.terminals.close(c).then(ack),
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
