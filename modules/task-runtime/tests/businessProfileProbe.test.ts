import { expect, test } from 'bun:test';
import type { AgentEvent, RunnerBusinessEvent, RunnerBusinessReceipt, RunnerCommand, TaskId } from '@crewstation/contracts';
import { LaunchSpecSchema, RunnerCommandSchema, businessAgentDigestInput } from '@crewstation/contracts';
import { newResourceId, precondition } from '@crewstation/kernel';
import { probeBusinessProfile } from '../application/profile-testing/businessProfileProbe';
import { businessProbeTurn } from '../application/profile-testing/businessProbeTurns';
import type { TestRunner } from '../ports/platform';

function fixture() {
  const commands: RunnerCommand[] = [], receipts = new Map<string, RunnerBusinessReceipt>(), events = new Map<string, RunnerBusinessEvent[]>(), steps: string[] = [];
  const state = { supported: true, modern: false, legacyMapping: false, materialToken: '', inventory: true, mismatch: undefined as string | undefined, noTool: undefined as string | undefined, unknown: false, gap: false, rejectStart: false, lostReply: false, sessionToken: '', mcpToken: '' };
  const runner: TestRunner = {
    connectionStatus: async () => ({ connected: true, capabilities: { protocols: ['opencode'], pty: false, preview: false, ...(state.supported ? { businessExecutionV3: 1 as const } : {}), ...(state.modern ? { ...(state.legacyMapping ? { nativeModelMappingVersion: 1 as const } : { nativeModelMaterialVersion: 1 as const }), nativeConfigVersion: 1 as const, materialObjectsVersion: 1 as const, startupInventoryVersion: 1 as const } : {}) } }),
    listEvents: async () => [],
    getBusinessExecution: async (taskId, id) => ({ taskId, receipt: receipts.get(id)!, persistedThrough: receipts.get(id)!.lastSequence, acknowledgedThrough: receipts.get(id)!.lastSequence, complete: receipts.get(id)!.phase === 'finished' }),
    listBusinessExecutionEvents: async (_taskId, id, after = 0) => (events.get(id) ?? []).filter((event) => event.sequence > after),
    consumeBusinessExecution: async () => {},
    sendCommand: async (_taskId, command) => {
      commands.push(command);
      if (command.type === 'businessExecutionInfo') return { incarnation: '00000000-0000-4000-8000-000000000001', limits: { outputBytes: 100000, spoolBytes: 100000, eventBytes: 10000 } };
      if (command.type === 'startBusinessCommand') {
        state.mcpToken = command.command.join(' ').match(/text:"(cs-proof-[a-f0-9]+)"/)?.[1] ?? '';
        state.materialToken = command.command.join(' ').match(/Reply with exactly (cs-proof-[a-f0-9]+)/)?.[1] ?? '';
        receipts.set(command.executionId, { executionId: command.executionId, attempt: 1, payloadDigest: command.payloadDigest, incarnation: command.incarnation, phase: 'running', lastSequence: 1, acknowledgedSequence: 0, outputBytes: 18, result: null });
        events.set(command.executionId, [{ sequence: 1, occurredAt: new Date().toISOString(), frame: { type: 'output', stream: 'stdout', text: 'CS_MCP_PROBE_READY' } }]); return {};
      }
      if (command.type === 'cancelBusinessExecution') return {};
      if (command.type === 'startBusinessAgent') {
        if (state.rejectStart) throw precondition('Agent 执行参数摘要不匹配', { code: 'execution_conflict' });
        // A real HTTP/WS hop normalizes optional fields; its digest must match the Runner's parsed bytes.
        const wire = RunnerCommandSchema.parse(command);
        if (wire.type !== 'startBusinessAgent') throw new Error('wrong command');
        const digest = new Bun.CryptoHasher('sha256').update(businessAgentDigestInput(wire.agent, wire.digestNonce)).digest('hex');
        if (digest !== command.payloadDigest) throw precondition('Agent 执行参数摘要不匹配', { code: 'execution_conflict' });
        expect(digest).toBe(command.payloadDigest);
        const agent = command.agent, native = agent.businessNativeConfig;
        const nativeStep = native?.mcp.some((entry) => entry.type === 'local') ? 'nativeLocalMcp' : native?.mcp.length ? 'nativeRemoteMcp' : 'nativeConfig';
        const step = agent.platformOpencodeModels ? 'nativeModelMapping' : native ? nativeStep : agent.businessMaterialDownloads?.length ? 'materialObjects' : agent.resumeSessionId ? 'resume' : agent.systemPrompt ? 'systemPrompt' : agent.businessSkills?.length ? 'skills' : agent.mcp.length ? 'mcp' : 'events';
        const token = step === 'materialObjects' ? state.materialToken : step === 'resume' ? state.sessionToken : step === 'mcp' || step === 'nativeRemoteMcp' ? state.mcpToken : JSON.stringify(agent).match(/cs-proof-[a-f0-9]+/)![0];
        steps.push(step);
        if (step === 'events') state.sessionToken = token;
        const fields: Array<Partial<AgentEvent> & Pick<AgentEvent, 'type'>> = [{ type: 'session', sessionId: 'native-session' }, { type: 'text', text: state.mismatch === step ? 'unsupported' : token }, { type: 'usage', usage: { measurementId: 'turn', scope: 'session', mode: 'delta', inputTokens: 3, outputTokens: 1, cacheReadTokens: null, cacheWriteTokens: null, complete: true } }];
        if (agent.startupInventoryVersion === 1) fields.push({ type: 'startup-inventory', inventory: state.inventory ? { version: 1, state: 'verified', source: 'opencode-inventory', mcpServers: [{ name: 'crewstation-probe', status: 'connected' }] } : { version: 1, state: 'unavailable', reason: 'inventory-not-reported' } });
        if ((step === 'nativeModelMapping' || step === 'nativeConfig') && state.noTool !== step) fields.push({ type: 'tool-start', tool: { name: 'task' } });
        if (['mcp', 'nativeRemoteMcp', 'nativeLocalMcp'].includes(step) && state.noTool !== step) fields.push({ type: 'tool-start', tool: { name: 'crewstation_probe_nonce' } });
        const frames: RunnerBusinessEvent[] = fields.map((event, index) => ({ sequence: index + (state.gap ? 2 : 1), occurredAt: new Date().toISOString(), frame: { type: 'agent', event: { ...event, agentId: agent.agentId, seq: index + 1, at: new Date().toISOString() } } }));
        events.set(command.executionId, frames);
        receipts.set(command.executionId, { executionId: command.executionId, attempt: 1, payloadDigest: command.payloadDigest, incarnation: command.incarnation, phase: state.unknown ? 'unknown' : 'finished', lastSequence: frames.length, acknowledgedSequence: 0, outputBytes: 1, result: { reason: 'exited', exitCode: 0, durationMs: 1 } });
        if (state.lostReply) throw new Error('connection lost after start');
        return receipts.get(command.executionId);
      }
      if (command.type === 'getBusinessExecution') throw new Error('Probe must read persisted session receipt');
      if (command.type === 'readBusinessExecutionEvents') throw new Error('Runner already discarded acknowledged events');
      throw new Error(`unexpected ${command.type}`);
    },
  };
  const input = { testId: newResourceId(), profile: newResourceId(), revision: 1, launch: LaunchSpecSchema.parse({ protocol: 'opencode', binaryPath: '/usr/bin/opencode' }), image: `image@sha256:${'a'.repeat(64)}`, beforeStart: { profile: newResourceId(), revision: 1, contentHash: 'hash', vars: {}, secrets: {}, steps: [], configFile: { kind: 'none' as const }, captureOutput: false }, prompt: 'ordinary smoke', expectedReply: 'ordinary smoke' };
  return { state, commands, steps, runner, input, run: () => probeBusinessProfile({ runner, taskId: newResourceId() as TaskId, input, budgetMs: 100, pollMs: 1, heartbeat: async () => true, report: async () => {} }) };
}
test('ordinary/old Runner smoke never grants business capability; exact per-feature observations grant proof', async () => {
  const f = fixture(); f.state.supported = false; expect(await f.run()).toBeUndefined(); expect(f.commands).toHaveLength(0);
  f.state.supported = true;
  expect(await f.run()).toMatchObject({ protocolVersion: 3, capabilities: { events: true, usage: 'incremental', resume: true, systemPrompt: true, skills: true, mcp: true, platformDelegation: false } });
  expect(f.commands.filter((command) => command.type === 'startBusinessAgent')).toHaveLength(5);
  const resumed = f.commands.find((command) => command.type === 'startBusinessAgent' && command.agent.resumeSessionId);
  expect(resumed?.type === 'startBusinessAgent' && resumed.agent.initialPrompt).not.toContain(f.state.sessionToken);
  expect(f.commands.at(-1)?.type).toBe('cancelBusinessExecution');
});
test('optional feature failure remains false; event baseline failure grants no effective business execution', async () => {
  const f = fixture(); f.state.mismatch = 'skills'; expect((await f.run())?.capabilities).toMatchObject({ events: true, skills: false, mcp: true });
  const bad = fixture(); bad.state.mismatch = 'events'; expect((await bad.run())?.capabilities).toMatchObject({ events: false, usage: 'none', resume: false });
  expect(bad.commands.filter((command) => command.type === 'startBusinessAgent')).toHaveLength(1);
});
test('unknown execution and noncontiguous source events abort proof batch and cancel without a fresh retry', async () => {
  for (const problem of ['unknown', 'gap'] as const) {
    const f = fixture(); f.state[problem] = true; await expect(f.run()).rejects.toThrow();
    expect(f.commands.filter((command) => command.type === 'startBusinessAgent')).toHaveLength(1);
    expect(f.commands.at(-1)?.type).toBe('cancelBusinessExecution');
  }
});

test('explicit Runner rejection is preserved; a lost response reconciles the original execution without a new start', async () => {
  const rejected = fixture(); rejected.state.rejectStart = true;
  await expect(rejected.run()).rejects.toMatchObject({ kind: 'precondition', details: { code: 'execution_conflict' } });
  expect(rejected.commands.some((command) => command.type === 'getBusinessExecution')).toBe(false);
  const uncertain = fixture(); uncertain.state.lostReply = true;
  expect((await uncertain.run())?.capabilities.events).toBe(true);
  expect(uncertain.commands.filter((command) => command.type === 'startBusinessAgent')).toHaveLength(5);
});

test('档位首轮未带可选技能时，摘要仍与真正 Runner 解析后的默认值一致', async () => {
  const f = fixture(), agentId = newResourceId(), token = 'cs-proof-0123456789abcdef';
  const agent = { id: 'pft-start-first', type: 'startAgent' as const, agentId, compute: f.input.profile, profileRevision: f.input.revision,
    launch: f.input.launch, permission: 'full' as const, mode: 'oneshot' as const, initialPrompt: token, mcp: [], env: {},
    beforeStart: f.input.beforeStart, processAttemptId: 'first:1' };
  // 实机首轮在解析前计算摘要，Runner 补入 businessSkills=[] 后误拒绝；不能只验证已 parse 的能力探针。
  expect(agent).not.toHaveProperty('businessSkills');
  const accepted: RunnerCommand[] = [];
  const turn = await businessProbeTurn({ runner: f.runner, taskId: newResourceId() as TaskId, budgetMs: 100, pollMs: 1,
    heartbeat: async () => true, accept: async command => { accepted.push(command); } }, agent, token);
  expect(turn.ok).toBe(true);
  expect(accepted).toHaveLength(1);
  expect(accepted[0]).toMatchObject({ agentId, businessSkills: [] });
  expect(f.commands.filter(command => command.type === 'startBusinessAgent')).toHaveLength(1);
});


test('new Runner declarations alone do not grant native, object or inventory proof without successful observed turns', async () => {
  const f = fixture(); f.state.modern = true;
  expect(await f.run()).toMatchObject({ nativeProbeVersion: 2, capabilities: { nativeConfigVersion: 1, materialObjectsVersion: 1, startupInventoryVersion: 1 } });
  expect(f.commands.filter((command) => command.type === 'startBusinessAgent')).toHaveLength(9);
  for (const feature of ['nativeConfig', 'materialObjects'] as const) {
    const failed = fixture(); failed.state.modern = true; failed.state.mismatch = feature;
    expect((await failed.run())?.capabilities[feature === 'nativeConfig' ? 'nativeConfigVersion' : 'materialObjectsVersion']).toBeUndefined();
  }
  const missing = fixture(); missing.state.modern = true; missing.state.inventory = false;
  expect((await missing.run())?.capabilities.startupInventoryVersion).toBeUndefined();
});


test('structured model delegation capability requires successful mapped internal task turn, not Runner declaration alone', async () => {
  const f = fixture(); f.state.modern = true;
  expect((await f.run())?.capabilities.nativeModelMappingVersion).toBeUndefined();
  f.input.launch = LaunchSpecSchema.parse({ protocol: 'opencode', binaryPath: '/usr/bin/opencode', model: 'gateway/m', opencodeProvider: { id: 'gateway', npm: '@ai-sdk/openai-compatible', models: { m: { name: 'M' } }, options: {} } });
  expect((await f.run())?.capabilities.nativeModelMappingVersion).toBe(1);
  const mapped = f.commands.find((entry) => entry.type === 'startBusinessAgent' && entry.agent.platformOpencodeModels);
  expect(mapped?.type === 'startBusinessAgent' && mapped.agent.platformOpencodeModels?.root).toBe('cs-platform-proof-root/m');
  f.state.mismatch = 'nativeModelMapping'; expect((await f.run())?.capabilities.nativeModelMappingVersion).toBeUndefined();
});

// RFC-040 V12: the old probe granted nativeConfigVersion from a root Agent body alone while the
// capability unlocks business sub-agents, plugins and inline MCP. Each path is now proven in turn.
test('native material needs a delegated sub-agent plugin call and inline remote and local MCP; Claude is never claimed', async () => {
  const f = fixture(); f.state.modern = true; await f.run();
  expect(f.steps).toEqual(['events', 'resume', 'systemPrompt', 'skills', 'mcp', 'nativeConfig', 'nativeRemoteMcp', 'nativeLocalMcp', 'materialObjects']);
  const starts = f.commands.flatMap((command) => command.type === 'startBusinessAgent' && command.agent.businessNativeConfig ? [command.agent.businessNativeConfig] : []);
  expect(starts[0]).toMatchObject({ protocol: 'opencode', subagents: [{ name: 'business-proof-helper', options: { mode: 'subagent' } }], plugins: [{ entry: 'index.js' }] });
  expect(starts[1]?.mcp).toEqual([{ name: 'business-proof-remote', type: 'remote', url: 'http://127.0.0.1:18089/mcp', oauth: false }]);
  expect(starts[2]?.mcp[0]).toMatchObject({ name: 'business-proof-local', type: 'local', command: ['bun', '-e', expect.stringContaining('tools/call')] });
  for (const step of ['nativeConfig', 'nativeRemoteMcp', 'nativeLocalMcp']) {
    for (const failure of ['mismatch', 'noTool'] as const) {
      const failed = fixture(); failed.state.modern = true; failed.state[failure] = step;
      const proof = await failed.run();
      expect(proof?.capabilities.nativeConfigVersion).toBeUndefined(); expect(proof?.capabilities.materialObjectsVersion).toBe(1);
    }
  }
  const claude = fixture(); claude.state.modern = true; claude.input.launch = LaunchSpecSchema.parse({ protocol: 'claude-code', binaryPath: '/usr/bin/claude' });
  const proof = await claude.run();
  expect(proof).toMatchObject({ nativeProbeVersion: 2 }); expect(proof?.capabilities.nativeConfigVersion).toBeUndefined();
  expect(claude.steps.some((step) => step.startsWith('native'))).toBe(false);
});

test('model mapping uses the structured-material Runner bit and forwards only declared provider secrets', async () => {
  const provider = { id: 'gateway', npm: '@ai-sdk/openai-compatible', models: { m: { name: 'M' } }, options: { baseURL: 'https://model.example/v1' }, credentials: { apiKey: 'MODEL_KEY' } };
  const f = fixture(); f.state.modern = true; f.input.launch = LaunchSpecSchema.parse({ protocol: 'opencode', binaryPath: '/usr/bin/opencode', model: 'gateway/m', opencodeProvider: provider });
  f.input.beforeStart = { ...f.input.beforeStart, secrets: { MODEL_KEY: 'pinned-model-key', UNRELATED: 'other-secret' } };
  expect((await f.run())?.capabilities.nativeModelMappingVersion).toBe(1);
  const mapped = f.commands.find((entry) => entry.type === 'startBusinessAgent' && entry.agent.platformOpencodeModels);
  const material = mapped?.type === 'startBusinessAgent' ? mapped.agent.platformOpencodeModels : undefined;
  expect(material?.version).toBe(2);
  expect(material?.providers['cs-platform-proof-root']).toEqual({ provider: expect.objectContaining({ id: 'gateway', credentials: { apiKey: 'MODEL_KEY' } }), secrets: { MODEL_KEY: 'pinned-model-key' } });
  expect(JSON.stringify(material)).not.toContain('other-secret');
  const legacy = fixture(); legacy.state.modern = true; legacy.state.legacyMapping = true; legacy.input.launch = f.input.launch; legacy.input.beforeStart = f.input.beforeStart;
  expect((await legacy.run())?.capabilities.nativeModelMappingVersion).toBeUndefined();
  expect(legacy.steps).not.toContain('nativeModelMapping');
});
