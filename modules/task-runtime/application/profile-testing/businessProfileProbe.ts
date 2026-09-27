import { startMcpProbe } from './mcpProbeServer';
import { randomBytes } from 'node:crypto';
import type { BusinessExecutionProof, ProfileTestStage, StartAgentCommand } from '@crewstation/contracts';
import { PLATFORM_AGENT_PERMISSION, StartAgentCommandSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import type { ProfileTestRunInput } from '../../api/moduleApi';
import type { BusinessProbeTurnDeps } from './businessProbeTurns';
import { businessProbeTurn } from './businessProbeTurns';

interface Input extends BusinessProbeTurnDeps { input: ProfileTestRunInput; report(stage: ProfileTestStage): Promise<void> }
/** Capabilities come from actual CLI behavior in the fixed image/revision, never from the driver name or version alone. */
export async function probeBusinessProfile(deps: Input): Promise<BusinessExecutionProof | undefined> {
  const connected = await deps.runner.connectionStatus(deps.taskId);
  if (connected.capabilities?.businessExecutionV3 !== 1) return undefined;
  const capabilities: BusinessExecutionProof['capabilities'] = { events: false, usage: 'none', resume: false, systemPrompt: false, skills: false, mcp: false, platformDelegation: false, opaqueInternalDelegation: true };
  const command = (patch: Partial<StartAgentCommand>): StartAgentCommand => {
    const agentId = newResourceId();
    return StartAgentCommandSchema.parse({ id: agentId, type: 'startAgent', agentId, processAttemptId: agentId, compute: deps.input.profile, profileRevision: deps.input.revision, launch: deps.input.launch, beforeStart: deps.input.beforeStart,
      permission: PLATFORM_AGENT_PERMISSION, mode: 'oneshot', env: {}, mcp: [], ...patch });
  };
  const nonce = () => `cs-proof-${randomBytes(12).toString('hex')}`;
  const probe = async (name: string, agent: StartAgentCommand, expected: string) => {
    await deps.report({ id: `business:${name}`, kind: 'model', name: `业务能力：${name}`, state: 'running' });
    const turn = await businessProbeTurn(deps, agent, expected);
    await deps.report({ id: `business:${name}`, kind: 'model', name: `业务能力：${name}`, state: turn.ok ? 'succeeded' : 'failed', ...(turn.ok ? {} : { detail: 'CLI 未通过此能力实测，业务 API 将明确拒绝依赖该能力的调用' }) });
    return turn;
  };
  const firstToken = nonce(), first = await probe('events', command({ initialPrompt: `Remember this token in this conversation and reply with it exactly, without markup: ${firstToken}` }), firstToken);
  if (!first.ok) return { protocolVersion: 3, capabilities };
  capabilities.events = true;
  const usages = first.events.filter((event) => event.type === 'usage' && event.usage);
  capabilities.usage = usages.length ? (usages.some((event) => event.usage!.mode === 'delta') ? 'incremental' : 'final') : 'none';
  if (first.sessionId) {
    const resumed = await probe('resume', command({ resumeSessionId: first.sessionId, initialPrompt: 'Reply with the exact token from the preceding turn in this conversation. Do not read any files or use tools.' }), firstToken);
    capabilities.resume = resumed.ok && resumed.sessionId === first.sessionId;
  }
  const systemToken = nonce(); capabilities.systemPrompt = (await probe('systemPrompt', command({ systemPrompt: `For the next response output only this exact token: ${systemToken}`, initialPrompt: 'Follow the system instruction for your response. Do not use tools.' }), systemToken)).ok;
  const skillToken = nonce(); capabilities.skills = (await probe('skills', command({ businessSkills: [{ path: 'crewstation-probe/SKILL.md', content: `---\nname: crewstation-probe\ndescription: Mandatory CrewStation capability probe\n---\nReply with exactly ${skillToken}, without any other text.\n` }], initialPrompt: 'Load and follow the crewstation-probe skill. It contains the exact response required for this capability test.' }), skillToken)).ok;
  const mcpToken = nonce(); const server = await startMcpProbe(deps, mcpToken);
  try {
    const tested = await probe('mcp', command({ mcp: [{ name: 'crewstation-probe', url: 'http://127.0.0.1:18089/mcp', headers: {} }], initialPrompt: 'Call the crewstation-probe MCP tool named nonce and reply only with its returned token.' }), mcpToken);
    capabilities.mcp = tested.ok && tested.events.some((event) => event.type === 'tool-start' && event.tool?.name.includes('nonce'));
  } finally { await deps.runner.sendCommand(deps.taskId, { id: newResourceId(), type: 'cancelBusinessExecution', executionId: server }); }
  return { protocolVersion: 3, capabilities };
}
