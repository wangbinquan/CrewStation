import type { PlatformOpencodeModels, StartAgentCommand } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { ProfileTestRunInput } from '../../api/moduleApi';
import type { BusinessProbeTurn } from './businessProbeTurns';

/** Exercise two isolated provider aliases and an actual internal task call in the tested image. */
export async function probeModelMapping(input: ProfileTestRunInput, token: string, command: (patch: Partial<StartAgentCommand>) => StartAgentCommand, probe: (name: string, agent: StartAgentCommand, expected: string) => Promise<BusinessProbeTurn>): Promise<boolean> {
  const provider = input.launch.opencodeProvider, model = input.launch.model;
  if (input.launch.protocol !== 'opencode' || !provider || !model?.startsWith(`${provider.id}/`)) return false;
  const modelId = model.slice(provider.id.length + 1);
  const read = (name: string): string => { const value = input.beforeStart.secrets[name]; if (value === undefined) throw precondition('模型材料测试缺少凭据'); return value; };
  const existing = provider.options.headers, headers = Object.fromEntries(Object.entries(provider.credentials.headers ?? {}).map(([name, ref]) => [name, read(ref)]));
  const options = { ...provider.options, ...(provider.credentials.apiKey ? { apiKey: read(provider.credentials.apiKey) } : {}), ...(Object.keys(headers).length ? { headers: { ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}), ...headers } } : {}) };
  const root = `cs-platform-proof-root/${modelId}`, child = `cs-platform-proof-child/${modelId}`;
  const entry = { npm: provider.npm, models: { [modelId]: provider.models[modelId]! }, options, whitelist: [modelId] };
  const identity = { model, computeProfileId: input.profile, revision: input.revision };
  const models: PlatformOpencodeModels = { version: 1, root, subagents: { 'model-proof-child': child }, providers: { 'cs-platform-proof-root': entry, 'cs-platform-proof-child': entry }, identities: { [root]: identity, [child]: identity } };
  const result = await probe('nativeModelMapping', command({ platformOpencodeModels: models, businessNativeConfig: { version: 1, protocol: 'opencode', agent: { name: 'model-proof-root', body: 'Use the task tool to delegate to model-proof-child. Return its response exactly without markup.', options: {} }, subagents: [{ name: 'model-proof-child', body: `Reply with exactly ${token}. Do not use tools.`, options: { description: 'Required model mapping probe', mode: 'subagent' }, agentProfileId: input.profile }], plugins: [], mcp: [] }, initialPrompt: 'Delegate now to model-proof-child using the task tool and return only its response.' }), token);
  return result.ok && result.events.some((event) => event.type === 'tool-start' && event.tool?.name === 'task');
}
