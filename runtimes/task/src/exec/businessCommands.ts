import { businessMessages } from '../agents/businessMessages';
import { randomUUID } from 'node:crypto';
import { businessAgentDigestInput } from '@crewstation/contracts';
import type { StartAgentCommand } from '@crewstation/contracts';
import { BusinessAgentSupervisor } from '../agents/businessAgentSupervisor';
import type { AgentProcess } from '../agents/driver';
import type { CommandOf } from '../commandDispatcher';
import { RunnerCommandError } from '../commandError';
import type { BusinessExecDeps } from './businessExecSupervisor';
import { BusinessExecSupervisor } from './businessExecSupervisor';
import type { JournalLimits } from './executionJournal';
import { ExecutionJournal } from './executionJournal';
import type { BusinessFiles } from '../files/businessFiles';
import { createBusinessFiles } from '../files/businessFiles';

export interface BusinessCommands {
  info(usageObservationsV1?: 1, nativeUsageTreeV1?: 1): Promise<{ incarnation: string; limits: JournalLimits; usageObservationsV1?: 1; nativeUsageTreeV1?: 1 }>;
  start(input: CommandOf<'startBusinessCommand'>): Promise<unknown>;
  sendMessage(input: CommandOf<'sendBusinessMessage'>): Promise<unknown>;
  getMessage(input: CommandOf<'getBusinessMessage'>): Promise<unknown>;
  startAgent(input: CommandOf<'startBusinessAgent'>): Promise<unknown>;
  get(id: string): Promise<unknown>;
  cancel(input: CommandOf<'cancelBusinessExecution'>): Promise<unknown>;
  read(id: string, after: number, limit: number): Promise<unknown>;
  acknowledge(id: string, through: number): Promise<unknown>;
  files: BusinessFiles;
  stop(): Promise<void>;
}

/** 只有配置了受保护持久目录才启用；完整 Agent／文件能力落地前不宣告 businessExecutionV3。 */
export function createBusinessCommands(deps: Omit<BusinessExecDeps, 'journal'>, directory: string | undefined, limits: JournalLimits, createAgent?: (command: StartAgentCommand, usageObservationsV1?: 1, native?: { nativeUsageTreeV1?: 1; nativeUsageLineageKey?: string }) => Promise<AgentProcess>): BusinessCommands {
  if (!directory) return disabledCommands();
  const incarnation = randomUUID(), journal = new ExecutionJournal(directory, incarnation, limits);
  const supervisor = new BusinessExecSupervisor({ ...deps, journal });
  const agents = new BusinessAgentSupervisor(journal, deps.logger);
  const messages = businessMessages(journal, agents);
  return {
    ...messages,
    files: createBusinessFiles(deps.paths.root),
    info: async (version, nativeVersion) => ({ incarnation, limits, ...(version === 1 && createAgent ? { usageObservationsV1: 1 as const, ...(nativeVersion === 1 ? { nativeUsageTreeV1: 1 as const } : {}) } : {}) }),
    startAgent: async (input) => {
      if (!createAgent) throw new RunnerCommandError('unsupported_capability', 'Runner 未启用业务 Agent');
      if (input.incarnation !== incarnation) throw new RunnerCommandError('execution_incarnation_changed', 'Runner 已更换，先查询旧执行回执');
      const digest = new Bun.CryptoHasher('sha256').update(businessAgentDigestInput(input.agent, input.digestNonce)).digest('hex');
      if (digest !== input.payloadDigest) throw new RunnerCommandError('execution_conflict', 'Agent 执行参数摘要不匹配');
      return agents.start(input, () => createAgent(input.agent, input.usageObservationsV1, { nativeUsageTreeV1: input.nativeUsageTreeV1, nativeUsageLineageKey: input.nativeUsageLineageKey }));
    },
    start: async (input) => {
      if (input.incarnation !== incarnation) throw new RunnerCommandError('execution_incarnation_changed', 'Runner 已更换，先查询旧执行回执');
      return supervisor.start(input);
    },
    get: async (id) => {
      const receipt = journal.get(id);
      if (!receipt) throw new RunnerCommandError('execution_not_found', '执行记录不存在');
      return receipt;
    },
    cancel: async (input) => {
      if (input.registration?.incarnation !== undefined && input.registration.incarnation !== incarnation) throw new RunnerCommandError('execution_incarnation_changed', 'Runner 已更换，不能取消未经证明的旧进程');
      if (agents.owns(input.executionId)) return agents.cancel(input.executionId);
      return input.registration ? supervisor.cancelRegistered({ executionId: input.executionId, ...input.registration }) : supervisor.cancel(input.executionId);
    },
    read: async (id, after, limit) => journal.replay(id, after, limit),
    acknowledge: async (id, through) => { journal.acknowledge(id, through); return {}; },
    stop: async () => { await Promise.all([supervisor.drain(), agents.drain()]); await messages.drainMessages(); journal.close(); },
  };
}

function disabledCommands(): BusinessCommands {
  const unsupported = async (): Promise<never> => { throw new RunnerCommandError('unsupported_capability', 'Runner 未配置可靠业务执行存储'); };
  return { info: unsupported, start: unsupported, startAgent: unsupported, sendMessage: unsupported, getMessage: unsupported, get: unsupported, cancel: unsupported, read: unsupported, acknowledge: unsupported, files: { read: unsupported, list: unsupported }, stop: async () => {} };
}
