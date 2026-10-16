import type { PlatformOpencodeModels, StartAgentCommand } from '@crewstation/contracts';
import { opencodeProviderSecretNames } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { ProfileTestRunInput } from '../../api/moduleApi';
import type { BusinessProbeTurn } from './businessProbeTurns';

type ProbeCommand = (patch: Partial<StartAgentCommand>) => StartAgentCommand;
type Probe = (name: string, agent: StartAgentCommand, expected: string) => Promise<BusinessProbeTurn>;

/**
 * Exercise two isolated provider aliases and an actual internal task call in the tested image. Only structured provider
 * material and the provider's declared secrets are sent; the Runner's agent-drivers renders them (RFC-040 V12).
 */
export async function probeModelMapping(input: ProfileTestRunInput, token: string, command: ProbeCommand, probe: Probe): Promise<boolean> {
  const provider = input.launch.opencodeProvider, model = input.launch.model;
  if (input.launch.protocol !== 'opencode' || !provider || !model?.startsWith(`${provider.id}/`)) return false;
  const modelId = model.slice(provider.id.length + 1);
  const secrets = Object.fromEntries(opencodeProviderSecretNames(provider).map((name) => { const value = input.beforeStart.secrets[name]; if (value === undefined) throw precondition('模型材料测试缺少凭据'); return [name, value]; }));
  const root = `cs-platform-proof-root/${modelId}`, child = `cs-platform-proof-child/${modelId}`, entry = { provider, secrets };
  const identity = { model, computeProfileId: input.profile, revision: input.revision };
  const models: PlatformOpencodeModels = { version: 2, root, subagents: { 'model-proof-child': child }, providers: { 'cs-platform-proof-root': entry, 'cs-platform-proof-child': entry }, identities: { [root]: identity, [child]: identity } };
  const result = await probe('nativeModelMapping', command({ platformOpencodeModels: models, businessNativeConfig: { version: 1, protocol: 'opencode', agent: { name: 'model-proof-root', body: 'Use the task tool to delegate to model-proof-child. Return its response exactly without markup.', options: {} }, subagents: [{ name: 'model-proof-child', body: `Reply with exactly ${token}. Do not use tools.`, options: { description: 'Required model mapping probe', mode: 'subagent' }, agentProfileId: input.profile }], plugins: [], mcp: [] }, initialPrompt: 'Delegate now to model-proof-child using the task tool and return only its response.' }), token);
  return result.ok && result.events.some((event) => event.type === 'tool-start' && event.tool?.name === 'task');
}

const called = (turn: BusinessProbeTurn, name: (tool: string) => boolean) => turn.events.some((event) => event.type === 'tool-start' && !!event.tool && name(event.tool.name));
/** Instructions travel in the user turn: the body channel is the separately proven systemPrompt capability. */
const nativeAgent = (initialPrompt: string, extra: Partial<NonNullable<StartAgentCommand['businessNativeConfig']>> = {}): Pick<StartAgentCommand, 'businessNativeConfig' | 'initialPrompt'> => ({
  businessNativeConfig: { version: 1, protocol: 'opencode', agent: { name: 'business-proof', body: '', options: { description: 'Native material proof' } }, subagents: [], mcp: [], plugins: [], ...extra }, initialPrompt,
});
/**
 * RFC-040 V12: `nativeConfigVersion` unlocks business sub-agents, inline MCP and plugins, so each path must actually work in the
 * tested OpenCode image: a native root Agent delegating to a native sub-agent that calls a plugin tool, and inline remote and local MCP.
 */
export async function probeNativeMaterial(nonce: () => string, command: ProbeCommand, probe: Probe, remote: { url: string; token: string }, localCommand: (token: string) => string[]): Promise<boolean> {
  const pluginToken = nonce(), localToken = nonce();
  const plugin = { name: 'business-proof-plugin', entry: 'index.js', files: [{ kind: 'file' as const, path: 'index.js', content: `export const BusinessProofPlugin = async () => ({ tool: { business_proof_token: { description: 'Return the plugin probe token', args: {}, async execute() { return ${JSON.stringify(pluginToken)}; } } } });\n` }] };
  const helper = { name: 'business-proof-helper', body: '', options: { description: 'Calls the business_proof_token tool and returns its output', mode: 'subagent' as const } };
  const delegated = await probe('nativeConfig', command(nativeAgent('Use the task tool to delegate to the business-proof-helper agent and ask it to call the business_proof_token tool. Reply with exactly the token it returns, without markup.', { plugins: [plugin], subagents: [helper] })), pluginToken);
  if (!delegated.ok || !called(delegated, (tool) => tool === 'task')) return false;
  const inline = await probe('nativeRemoteMcp', command(nativeAgent('Call the nonce tool of the business-proof-remote MCP server and reply only with the token it returns.', { mcp: [{ name: 'business-proof-remote', type: 'remote', url: remote.url, oauth: false }] })), remote.token);
  if (!inline.ok || !called(inline, (tool) => tool.includes('nonce'))) return false;
  const local = await probe('nativeLocalMcp', command(nativeAgent('Call the nonce tool of the business-proof-local MCP server and reply only with the token it returns.', { mcp: [{ name: 'business-proof-local', type: 'local', command: localCommand(localToken) }] })), localToken);
  return local.ok && called(local, (tool) => tool.includes('nonce'));
}
