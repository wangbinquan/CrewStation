import { expect, test } from 'bun:test';
import type { BeforeStartMaterial, RunnerCommand, RunnerHello } from '@crewstation/contracts';
import { LaunchSpecSchema, TASKRUNNER_PROTOCOL_VERSION, TaskIdSchema } from '@crewstation/contracts';
import { fixedClock, noopLogger } from '@crewstation/kernel';
import type { SessionUseCaseDeps } from '../application/dependencies';
import { runnerHub } from '../application/runnerHub';
import { assertLaunchSupported, protocolMismatchOf } from '../domain/runtimeNegotiation';

const material: BeforeStartMaterial = { profile: 'gw', revision: 1, contentHash: 'h', steps: [
  { kind: 'script', stepId: 'py', name: 'py', language: 'python', source: 'print(1)', argv: [], timeoutMs: 1000 },
  { kind: 'script', stepId: 'custom', name: 'custom', language: 'custom', interpreter: ['/opt/tool'], source: 'x', argv: [], timeoutMs: 1000 },
], vars: {}, secrets: {}, configFile: { kind: 'none' }, captureOutput: false };
const start: RunnerCommand = { id: 'c', type: 'startAgent', agentId: 'a', compute: 'gw', profileRevision: 1, launch: LaunchSpecSchema.parse({ protocol: 'opencode', binaryPath: '/usr/local/bin/opencode' }), permission: 'edit', mode: 'oneshot', mcp: [], env: {}, beforeStart: material, processAttemptId: 'a:1' };
const base: RunnerHello['capabilities'] = { protocols: ['claude-code', 'opencode', 'terminal'], pty: true, preview: false };

test('不支持该协议或缺解释器的 Runner 在写 socket 前被拒；具备能力则放行，其他命令不受影响（RFC-006）', () => {
  expect(() => assertLaunchSupported(start, { ...base, protocols: ['claude-code'] })).toThrow(expect.objectContaining({ details: expect.objectContaining({ code: 'protocol_unsupported', protocol: 'opencode' }) }));
  expect(() => assertLaunchSupported(start, { ...base, interpreters: [{ language: 'shell', command: '/bin/bash', version: '5' }] }))
    .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: 'interpreter_unavailable', missing: ['python'], profile: 'gw' }) }));
  expect(() => assertLaunchSupported(start, { ...base, interpreters: [{ language: 'python', command: '/usr/bin/python3', version: '3.12' }] })).not.toThrow();
  const probe: RunnerCommand = { id: 'p', type: 'probeTerminal', probeId: 'pft-1', compute: 'tool', profileRevision: 1, launch: LaunchSpecSchema.parse({ protocol: 'terminal', binaryPath: '/opt/tool/bin/tool' }), command: ['/opt/tool/bin/tool', '--version'], expect: '\\d', timeoutMs: 5000, mcp: [], env: {}, beforeStart: { ...material, steps: [] }, processAttemptId: 'p:1' };
  expect(() => assertLaunchSupported(probe, { ...base, protocols: ['claude-code', 'opencode'] })).toThrow(expect.objectContaining({ details: expect.objectContaining({ code: 'protocol_unsupported' }) }));
  expect(() => assertLaunchSupported(probe, base)).not.toThrow();
  expect(() => assertLaunchSupported({ id: 'x', type: 'listAgentTerminals' }, base)).not.toThrow();
});

test('旧底座 Runner（协议 1）的 hello：令牌有效才回写原因，且不接管连接、不发 welcome；伪造令牌与坏帧不回写', async () => {
  const taskId = TaskIdSchema.parse('01a0bf5d-8f4b-7b61-81de-655e8f149909'), rejections: unknown[] = [], frames: string[] = [];
  const deps: SessionUseCaseDeps = {
    clock: fixedClock('2026-09-18T10:00:00Z'), logger: noopLogger,
    settings: { commandTimeoutMs: 1000, runnerStaleMs: 30000, replayLimit: 100, selfAddress: 'http://session' },
    events: { append: async () => {}, maxSeq: async () => 0, listSince: async () => [], summarize: async () => [] },
    registry: { claim: async () => {}, release: async () => {}, heartbeat: async () => {}, lookup: async () => undefined },
    runnerAuth: { verifyRunnerToken: async (_id, token) => (token === 'good' ? { ok: true, projectId: 'project' } : { ok: false, reason: '令牌无效' }) },
    taskAccess: { canOpenStream: async () => true, onRunnerConnected: async () => true, onRunnerDisconnected: async () => {}, onRunnerRejected: async (id, token, rejection) => { rejections.push({ id, token, ...rejection }); } },
    forwarder: { forward: async () => ({}) },
  };
  const hub = runnerHub(deps);
  const oldHello = (token: string) => ({ type: 'hello', protocolVersion: 1, taskId, runnerToken: token, workdir: '/work', capabilities: { drivers: ['claude-code'], pty: true, preview: true, agentRuntimeConfig: 1 } });
  expect(await hub.onHello(oldHello('forged'), { send: (f) => frames.push(f) })).toMatchObject({ ok: false, code: 'unauthorized' });
  const rejected = await hub.onHello(oldHello('good'), { send: (f) => frames.push(f) });
  expect(rejected).toMatchObject({ ok: false, code: 'protocol_mismatch', message: `Runner 协议版本 1，平台要求 ${TASKRUNNER_PROTOCOL_VERSION}；请基于当前平台底座镜像重建镜像` });
  expect(rejections).toEqual([{ id: taskId, token: 'good', code: 'protocol_mismatch', runnerProtocol: 1, message: (rejected as { message: string }).message }]);
  expect(frames).toHaveLength(0);
  expect(hub.connections.has(taskId)).toBe(false);
  expect(await hub.onHello({ type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId }, { send: (f) => frames.push(f) })).toMatchObject({ ok: false, code: 'bad_hello' });
  expect(protocolMismatchOf({ type: 'hello', protocolVersion: 'x', taskId, runnerToken: 't' })).toMatchObject({ runnerProtocol: null });
  expect(protocolMismatchOf({ type: 'result', id: 'r' })).toBeUndefined();
  expect(rejections).toHaveLength(1);
});
