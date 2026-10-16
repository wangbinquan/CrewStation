import { expect, test } from 'bun:test';
import { AgentProfileSchema, BusinessMaterialRequestSchema, TasksSpecSchema, SubmitBusinessSubtaskV3Schema } from '@crewstation/contracts';
import { BUSINESS_AGENT_CAPABILITIES } from './executionAgent';
import { validateBusinessMaterial } from './businessMaterials';
import { authorizeCommandEnvironment } from './executionCommand';
const profile = AgentProfileSchema.parse({ id: Bun.randomUUIDv7(), name: 'worker', compute: { kind: 'default' }, businessConfig: { allowSkills: true, nativeConfig: { agentDefinitions: true, inlineRemoteMcp: true, inlineLocalMcp: true, plugins: true } } });
const material = BusinessMaterialRequestSchema.parse({ requestKey: 'native', nativeConfig: { version: 1, protocol: 'opencode', agent: { name: 'review', body: '', options: {} }, subagents: [{ name: 'helper', body: '', options: {} }], mcp: [{ name: 'local', type: 'local', command: ['tool'], env: { APP_MODE: 'read' } }, { name: 'remote', type: 'remote', url: 'https://mcp.test' }], plugins: [{ name: 'extension', entry: 'index.js', files: [{ kind: 'file', path: 'index.js', content: 'export default {}' }] }] } });
const platform = { protocol: 'opencode' as const, mcp: [], reservedEnv: [] };
test('native admission requires immutable release permissions, exact protocol and tested capability', () => {
  expect(() => validateBusinessMaterial(profile, material, BUSINESS_AGENT_CAPABILITIES, platform, [profile])).not.toThrow();
  for (const key of ['agentDefinitions', 'inlineRemoteMcp', 'inlineLocalMcp', 'plugins'] as const) {
    const denied = { ...profile, businessConfig: { ...profile.businessConfig!, nativeConfig: { ...profile.businessConfig!.nativeConfig!, [key]: false } } };
    expect(() => validateBusinessMaterial(denied, material, BUSINESS_AGENT_CAPABILITIES, platform, [profile])).toThrow('未允许');
  }
  expect(() => validateBusinessMaterial(profile, material, { ...BUSINESS_AGENT_CAPABILITIES, nativeConfigVersion: undefined }, platform, [profile])).toThrow('不支持');
  expect(() => validateBusinessMaterial(profile, material, { ...BUSINESS_AGENT_CAPABILITIES, opaqueInternalDelegation: false }, platform, [profile])).toThrow('不支持');
  expect(() => validateBusinessMaterial(profile, material, BUSINESS_AGENT_CAPABILITIES, { ...platform, protocol: 'claude-code' }, [profile])).toThrow('未允许');
  expect(() => validateBusinessMaterial(profile, material, BUSINESS_AGENT_CAPABILITIES, { ...platform, reservedEnv: ['APP_MODE'] }, [profile])).toThrow('未允许');
  expect(() => validateBusinessMaterial(profile, material, BUSINESS_AGENT_CAPABILITIES, { ...platform, mcp: [{ name: 'remote', url: 'https://platform.test', headers: {} }] }, [profile])).toThrow('未允许');
});
test('an object-backed skill cannot bypass the independent object-material capability', () => {
  const input = BusinessMaterialRequestSchema.parse({ requestKey: 'object', skills: [{ path: 'review/data', object: { objectId: Bun.randomUUIDv7(), sha256: 'a'.repeat(64), size: 1 } }] });
  expect(() => validateBusinessMaterial(profile, input, { ...BUSINESS_AGENT_CAPABILITIES, materialObjectsVersion: undefined }, platform, [profile])).toThrow('不支持');
});
test('only a frozen command allowlist grants Secret injection; old literal requests keep their semantics', () => {
  const spec = TasksSpecSchema.parse({ taskProfileId: Bun.randomUUIDv7() });
  const raw = SubmitBusinessSubtaskV3Schema.parse({ requestKey: 'git', kind: 'command', name: 'git', argv: ['git'], env: { GIT_TOKEN: 'literal' } });
  if (raw.kind !== 'command') throw new Error('fixture');
  expect(authorizeCommandEnvironment(spec, raw)).toEqual({});
  const id = Bun.randomUUIDv7(), secret = { ...raw, env: { GIT_TOKEN: { secret: { configDefinitionId: id } } } };
  expect(() => authorizeCommandEnvironment(spec, secret)).toThrow('未允许');
  expect(authorizeCommandEnvironment({ ...spec, commandBusinessConfig: { allowedEnvNames: ['GIT_TOKEN'] } }, secret)).toEqual({ GIT_TOKEN: id });
  expect(() => authorizeCommandEnvironment({ ...spec, commandBusinessConfig: { allowedEnvNames: [] } }, raw)).toThrow('未允许');
});
// RFC-040 V12: OpenCode delivers native agent bodies through the same prompt field as systemPrompt,
// so a profile whose systemPrompt probe failed cannot be given native agent instructions either.
test('native root and sub-agent bodies require the systemPrompt capability; empty bodies do not', () => {
  const withoutPrompt = { ...BUSINESS_AGENT_CAPABILITIES, systemPrompt: false };
  expect(() => validateBusinessMaterial(profile, material, withoutPrompt, platform, [profile])).not.toThrow();
  for (const patch of [{ agent: { name: 'review', body: 'Review the change.', options: {} } }, { subagents: [{ name: 'helper', body: 'Check tests.', options: {} }] }]) {
    const bodied = BusinessMaterialRequestSchema.parse({ requestKey: 'body', nativeConfig: { ...material.nativeConfig!, ...patch } });
    expect(() => validateBusinessMaterial(profile, bodied, withoutPrompt, platform, [profile])).toThrow('systemPrompt');
    expect(() => validateBusinessMaterial(profile, bodied, BUSINESS_AGENT_CAPABILITIES, platform, [profile])).not.toThrow();
  }
});
