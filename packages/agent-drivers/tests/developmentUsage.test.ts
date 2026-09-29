// RFC-034: headless numeric collection cannot depend on business event mapping or alter legacy envs.
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RunnerUsageCaptureSchema, type AgentEvent, type RunnerUsageCapture } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { createClaudeCodeDriver } from '../drivers/claudeCode/driver';
import { createOpencodeDriver } from '../drivers/opencode/driver';
import { recordOpencodeBinaryVersion, resetOpencodeBinaryVersions } from '../drivers/opencode/versionRegistry';
import { resetOpencodeProbes } from '../drivers/opencode/probe';
import type { DriverAgentSpec, DriverLaunchContext } from '../contract/agentDriver';
import { createFakeProcessHost } from './fakeProcessHost';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const spec: DriverAgentSpec = { agentId: 'agent-development', compute: 'Named compute', profileRevision: 2, launch: { protocol: 'claude-code', binaryPath: '/bin/claude', extraArgs: [], isSandbox: false }, permission: 'full', mode: 'oneshot', initialPrompt: 'owner-prompt', mcp: [], usageObservationsV1: 1, nativeUsageTreeV1: 1, nativeUsageLineageKey: 'real-store-lineage' };
const final = JSON.stringify({ type: 'result', uuid: 'real-turn', session_id: 'real-session', subtype: 'success', is_error: false, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 } });
const lines = [JSON.stringify({ type: 'system', subtype: 'init', session_id: 'real-session' }), final];
function context(host: DriverLaunchContext['host'], usageSink?: DriverLaunchContext['usageSink']): DriverLaunchContext { const runDir = mkdtempSync(join(tmpdir(), 'cs-development-driver-')); roots.push(runDir); return { cwd: runDir, runDir, env: { PATH: '/usr/bin', HOME: 'original-home', XDG_DATA_HOME: 'original-data' }, host, logger: noopLogger, usageSink }; }
async function collect(events: AsyncIterable<AgentEvent>) { const result: AgentEvent[] = []; for await (const event of events) result.push(event); return result; }

test('explicit numeric sink gets real usage before terminal while ordinary events and HOME remain unchanged', async () => {
  const host = createFakeProcessHost([{ stdout: lines }]), captured: RunnerUsageCapture[] = [];
  const ctx = context(host, (capture) => { captured.push(RunnerUsageCaptureSchema.parse(capture)); if (captured.length === 1) expect(host.spawns).toHaveLength(0); });
  const events = await collect(createClaudeCodeDriver(() => '/bin/claude').start(spec, ctx).events);
  expect(events.map((e) => e.type)).toEqual(['started', 'session', 'completed']);
  expect(captured[0]?.nativeProof?.state).toBe('unsupported');
  expect(captured.flatMap((c) => c.measurements).find((m) => m.usage.input === '10')?.usage).toEqual({ input: '10', output: '5', cacheRead: '2', cacheWrite: '3' });
  expect(host.spawns[0]?.env.HOME).toBe('original-home'); expect(host.spawns[0]?.env.XDG_DATA_HOME).toBe('original-data');
  const old = await collect(createClaudeCodeDriver(() => '/bin/claude').start(spec, context(createFakeProcessHost([{ stdout: lines }]))).events);
  expect(old.map((e) => e.type)).toEqual(events.map((e) => e.type));
});

test('numeric sink failure cannot fail or automatically cancel the model execution', async () => {
  const host = createFakeProcessHost([{ stdout: lines }]); let attempts = 0;
  const events = await collect(createClaudeCodeDriver(() => '/bin/claude').start(spec, context(host, () => { attempts++; throw new Error('disk write failed'); })).events);
  expect(attempts).toBeGreaterThan(0); expect(events.at(-1)?.type).toBe('completed'); expect(host.spawns).toHaveLength(1);
});

test('OpenCode numeric channel retains explicit unavailable native-store evidence without reporting a complete zero', async () => {
  recordOpencodeBinaryVersion('/bin/opencode', '1.18.29');
  const host = createFakeProcessHost([{ stdout: [JSON.stringify({ type: 'step_finish', sessionID: 'root', part: { id: 'step-1', tokens: { input: 11, output: 7, cache: { read: 0, write: 0 } } } })] }]), captured: RunnerUsageCapture[] = [];
  const ctx = context(host, (capture) => captured.push(capture)); ctx.env.XDG_DATA_HOME = join(ctx.runDir!, 'missing-native-store');
  const events = await collect(createOpencodeDriver(() => '/bin/opencode').start({ ...spec, launch: { ...spec.launch, protocol: 'opencode', binaryPath: '/bin/opencode' } }, ctx).events);
  expect(events.some((e) => e.type === 'usage')).toBe(false); expect(events.at(-1)?.type).toBe('completed');
  expect(captured[0]?.nativeProof?.state).toBe('pending');
  expect(captured.at(-1)?.nativeProof?.state).toBe('partial');
  expect(captured.at(-1)?.nativeProof?.issues).toContain('native-store-unavailable');
  resetOpencodeBinaryVersions(); resetOpencodeProbes();
});
