import { expect, test } from 'bun:test';
import type { AgentRuntimeMaterial, RunnerCommand, RunnerHello } from '@crewstation/contracts';
import { assertRuntimeSupported } from '../domain/runtimeNegotiation';

const material: AgentRuntimeMaterial = { configId: 'arc_' + 'a'.repeat(32), configName: 'gw', revision: 1, driver: 'opencode', contentHash: 'h', steps: [
  { kind: 'script', stepId: 'py', name: 'py', language: 'python', source: 'print(1)', argv: [], timeoutMs: 1000 },
  { kind: 'script', stepId: 'custom', name: 'custom', language: 'custom', interpreter: ['/opt/tool'], source: 'x', argv: [], timeoutMs: 1000 },
], vars: {}, secrets: {}, configFile: { kind: 'none' }, captureOutput: false };
const start: RunnerCommand = { id: 'c', type: 'startAgent', agentId: 'a', compute: 'gw', driver: 'opencode', model: 'm', permission: 'edit', mode: 'oneshot', mcp: [], env: {}, runtime: material };
const base: RunnerHello['capabilities'] = { drivers: ['opencode'], pty: true, preview: false };

test('旧 Runner 与缺解释器的 Runner 在写 socket 前被拒；具备能力则放行，无 runtime 的命令不受影响', () => {
  expect(() => assertRuntimeSupported(start, base)).toThrow(expect.objectContaining({ details: expect.objectContaining({ code: 'agent_runtime_unavailable' }) }));
  expect(() => assertRuntimeSupported(start, { ...base, agentRuntimeConfig: 1, interpreters: [{ language: 'shell', command: '/bin/bash', version: '5' }] }))
    .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: 'interpreter_unavailable', missing: ['python'] }) }));
  expect(() => assertRuntimeSupported(start, { ...base, agentRuntimeConfig: 1, interpreters: [{ language: 'python', command: '/usr/bin/python3', version: '3.12' }] })).not.toThrow();
  expect(() => assertRuntimeSupported({ ...start, runtime: undefined } as RunnerCommand, base)).not.toThrow();
  expect(() => assertRuntimeSupported({ id: 'x', type: 'listAgentTerminals' }, base)).not.toThrow();
});
