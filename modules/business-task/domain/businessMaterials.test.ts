import { expect, test } from 'bun:test';
import { AgentProfileSchema, BusinessMaterialRequestSchema } from '@crewstation/contracts';
import type { BusinessAgentCapabilities } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { materialSecretReferences, validateBusinessMaterial } from './businessMaterials';

const capabilities: BusinessAgentCapabilities = { events: true, usage: 'incremental', resume: true, systemPrompt: true, skills: true, mcp: true, platformDelegation: true, opaqueInternalDelegation: true };
const platform = { reservedEnv: ['RESERVED'], mcp: [] };
const material = (input: object) => BusinessMaterialRequestSchema.parse({ requestKey: 'm', ...input });
const profile = AgentProfileSchema.parse({ id: newResourceId(), name: 'review', compute: { kind: 'default' } });

test('release opt-in and driver capabilities are independent; business material cannot grant a missing platform capability', () => {
  for (const input of [{ systemPrompt: 'review' }, { skills: [{ path: 's/SKILL.md', content: 'review' }] }, { env: { APP_TOKEN: 'value' } }]) expect(() => validateBusinessMaterial(profile, material(input), capabilities, platform, [profile])).toThrow('未允许');
  const enabled = AgentProfileSchema.parse({ ...profile, businessConfig: { allowSystemPromptAppend: true, allowSkills: true, allowedEnvNames: ['APP_TOKEN', 'RESERVED'] } });
  expect(() => validateBusinessMaterial(enabled, material({ systemPrompt: 'review' }), { ...capabilities, systemPrompt: false }, platform, [profile])).toThrow('不支持');
  expect(() => validateBusinessMaterial(enabled, material({ skills: [{ path: 's/SKILL.md', content: 'review' }] }), { ...capabilities, skills: false }, platform, [profile])).toThrow('不支持');
  expect(() => validateBusinessMaterial(enabled, material({ env: { RESERVED: 'value' } }), capabilities, platform, [profile])).toThrow('未允许');
  expect(() => validateBusinessMaterial(enabled, material({ systemPrompt: 'review', skills: [{ path: 's/SKILL.md', content: 'review' }], env: { APP_TOKEN: 'value' } }), capabilities, platform, [profile])).not.toThrow();
});

test('MCP references and subagent plans stay inside the pinned manifest; secret IDs are collected without values', () => {
  const connectionId = newResourceId(), secret = newResourceId(), child = AgentProfileSchema.parse({ ...profile, id: newResourceId(), name: 'child' });
  const enabled = AgentProfileSchema.parse({ ...profile, businessConfig: { allowedEnvNames: ['APP_TOKEN'], mcpConnections: [{ id: connectionId, name: 'docs', url: 'https://mcp.example', secretHeaders: { Authorization: secret }, allowedParameterKeys: ['scope'] }] } });
  const input = material({ env: { APP_TOKEN: { secret: { configDefinitionId: secret } } }, mcp: [{ connectionId, parameters: { scope: 'project' } }], subagents: [{ name: 'review', agentProfileId: child.id, description: 'review code' }] });
  expect(() => validateBusinessMaterial(enabled, input, capabilities, platform, [profile, child])).not.toThrow();
  expect(materialSecretReferences(input, enabled)).toEqual([secret]);
  expect(() => validateBusinessMaterial(enabled, input, capabilities, platform, [profile])).toThrow('未允许');
  expect(() => validateBusinessMaterial(enabled, input, { ...capabilities, platformDelegation: false }, platform, [profile, child])).toThrow('不支持');
  expect(() => validateBusinessMaterial(enabled, input, capabilities, { ...platform, mcp: [{ name: 'docs', url: 'https://platform.example', headers: {} }] }, [profile, child])).toThrow('重名');
  expect(() => validateBusinessMaterial(enabled, material({ mcp: [{ connectionId, parameters: { url: 'https://override.example' } }] }), capabilities, platform, [profile])).toThrow('参数');
  expect(() => validateBusinessMaterial(enabled, material({ mcp: [{ connectionId: newResourceId() }] }), capabilities, platform, [profile])).toThrow('未允许');
});
