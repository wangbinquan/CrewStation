import { relative } from 'node:path';
import { verifyBusinessOutput, withBusinessOutput } from '../contract/businessOutput';
import { createBusinessFiles } from '../files/businessFiles';
import { redactBusinessEvents } from './businessEventRedaction';
import { isKnownProtocol } from '@crewstation/contracts';
import type { StartAgentCommand } from '@crewstation/contracts';
import type { AgentSupervisorDeps } from './agentSupervisor';
import type { AgentProcess } from './driver';
import { ManagedAgentProcess } from './managedAgent';
import { RunnerCommandError } from '../commandError';

/** Only the platform-mounted native session directory survives cleanup of transient launch material. */
export function businessAgentFactory(deps: Omit<AgentSupervisorDeps, 'emit'>, persistentHome: string | undefined) {
  return async (command: StartAgentCommand, usageObservationsV1?: 1, native?: { nativeUsageTreeV1?: 1; nativeUsageLineageKey?: string }): Promise<AgentProcess> => {
    if (!persistentHome) throw new RunnerCommandError('unsupported_capability', 'Agent 缺少平台原生会话卷');
    if (!isKnownProtocol(command.launch.protocol)) throw new RunnerCommandError('protocol_unsupported', '业务 Agent 需要结构化驱动');
    const cwd = await deps.paths.resolveCwd(command.cwd);
    const inner = new ManagedAgentProcess({ ...command, businessEvents: true, usageObservationsV1, ...native }, {
      driver: deps.drivers.forProtocol(command.launch.protocol), beforeStart: deps.beforeStart, launcher: deps.launcher,
      cwd, persistentHome, commandEnv: command.env, material: command.beforeStart, processAttemptId: command.processAttemptId, logger: deps.logger,
    });
    return { send: (text) => inner.send(text), cancel: () => inner.cancel(), events: {
      async *[Symbol.asyncIterator]() {
        const events = command.businessOutputContract ? withBusinessOutput(inner.events, () => verifyBusinessOutput(createBusinessFiles(deps.paths.root), relative(deps.paths.root, cwd) || '.', command.businessOutputContract!)) : inner.events;
        try { yield* redactBusinessEvents(events, [...Object.values(command.beforeStart.secrets), ...(command.businessSecretEnvNames ?? []).map((key) => command.env[key] ?? ''), ...command.mcp.flatMap((entry) => Object.values(entry.headers))]); }
        finally { deps.beforeStart.release(command.agentId); }
      },
    } };
  };
}
