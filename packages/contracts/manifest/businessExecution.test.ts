import { expect, test } from 'bun:test';
import { AgentProfileSchema, TasksSpecSchema } from './tasks';
import { ServiceSpecSchema } from './serviceSpec';

const id = '01a0bf5d-8f4b-7000-8000-000000000001';

test('fenced execution declares supported task contracts without changing legacy manifests', () => {
  expect(TasksSpecSchema.parse({ taskProfileId: id })).not.toHaveProperty('executionControl');
  expect(TasksSpecSchema.safeParse({ taskProfileId: id, executionControl: 'fenced' }).success).toBe(false);
  expect(TasksSpecSchema.parse({ taskProfileId: id, executionControl: 'fenced', acceptedTaskContractVersions: ['aw/1'] })).toMatchObject({ executionControl: 'fenced', acceptedTaskContractVersions: ['aw/1'] });
});

test('business config defaults closed and MCP registrations reject duplicate names and non HTTP URLs', () => {
  const base = { id, name: 'review', compute: { kind: 'default' }, businessConfig: {} };
  expect(AgentProfileSchema.parse(base).businessConfig).toEqual({ allowSystemPromptAppend: false, allowSkills: false, allowedEnvNames: [], mcpConnections: [] });
  const mcp = { id, name: 'tools', url: 'https://tools.example/mcp' };
  expect(AgentProfileSchema.safeParse({ ...base, businessConfig: { mcpConnections: [mcp, mcp] } }).success).toBe(false);
  expect(AgentProfileSchema.safeParse({ ...base, businessConfig: { mcpConnections: [{ ...mcp, url: 'file:///etc/passwd' }] } }).success).toBe(false);
});

test('startup and readiness probes are explicit bounded declarations, existing healthPath remains sufficient', () => {
  const base = { command: ['bun', 'run', 'main.ts'], port: 3000, servicePlanId: id };
  expect(ServiceSpecSchema.parse(base)).not.toHaveProperty('probes');
  expect(ServiceSpecSchema.parse({ ...base, probes: { startup: { path: '/live', failureThreshold: 60 }, readiness: { path: '/ready' } } }).probes).toMatchObject({ startup: { path: '/live', timeoutSeconds: 1, failureThreshold: 60 }, readiness: { path: '/ready' } });
  for (const probe of [{ path: '/live', failureThreshold: 0 }, { path: '/live', timeoutSeconds: 61 }, { path: '/live', host: 'elsewhere' }, { path: 'live' }]) {
    expect(ServiceSpecSchema.safeParse({ ...base, probes: { startup: probe } }).success).toBe(false);
  }
});
