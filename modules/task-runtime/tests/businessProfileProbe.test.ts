import { expect, test } from 'bun:test';
import type { AgentEvent, RunnerBusinessEvent, RunnerBusinessReceipt, RunnerCommand, TaskId } from '@crewstation/contracts';
import { LaunchSpecSchema, RunnerCommandSchema, businessAgentDigestInput } from '@crewstation/contracts';
import { newResourceId, precondition } from '@crewstation/kernel';
import { probeBusinessProfile } from '../application/profile-testing/businessProfileProbe';
import type { TestRunner } from '../ports/platform';

function fixture() {
  const commands: RunnerCommand[] = [], receipts = new Map<string, RunnerBusinessReceipt>(), events = new Map<string, RunnerBusinessEvent[]>();
  const state = { supported: true, mismatch: undefined as string | undefined, unknown: false, gap: false, rejectStart: false, lostReply: false, sessionToken: '', mcpToken: '' };
  const runner: TestRunner = {
    connectionStatus: async () => ({ connected: true, capabilities: { protocols: ['opencode'], pty: false, preview: false, ...(state.supported ? { businessExecutionV3: 1 as const } : {}) } }),
    listEvents: async () => [],
    getBusinessExecution: async (taskId, id) => ({ taskId, receipt: receipts.get(id)!, persistedThrough: receipts.get(id)!.lastSequence, acknowledgedThrough: receipts.get(id)!.lastSequence, complete: receipts.get(id)!.phase === 'finished' }),
    listBusinessExecutionEvents: async (_taskId, id, after = 0) => (events.get(id) ?? []).filter((event) => event.sequence > after),
    consumeBusinessExecution: async () => {},
    sendCommand: async (_taskId, command) => {
      commands.push(command);
      if (command.type === 'businessExecutionInfo') return { incarnation: '00000000-0000-4000-8000-000000000001', limits: { outputBytes: 100000, spoolBytes: 100000, eventBytes: 10000 } };
      if (command.type === 'startBusinessCommand') {
        state.mcpToken = command.command.join(' ').match(/cs-proof-[a-f0-9]+/)![0];
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
        expect(digest).toBe(command.payloadDigest);
        const agent = command.agent, step = agent.resumeSessionId ? 'resume' : agent.systemPrompt ? 'systemPrompt' : agent.businessSkills?.length ? 'skills' : agent.mcp.length ? 'mcp' : 'events';
        const token = step === 'resume' ? state.sessionToken : step === 'mcp' ? state.mcpToken : JSON.stringify(agent).match(/cs-proof-[a-f0-9]+/)![0];
        if (step === 'events') state.sessionToken = token;
        const fields: Array<Partial<AgentEvent> & Pick<AgentEvent, 'type'>> = [{ type: 'session', sessionId: 'native-session' }, { type: 'text', text: state.mismatch === step ? 'unsupported' : token }, { type: 'usage', usage: { measurementId: 'turn', scope: 'session', mode: 'delta', inputTokens: 3, outputTokens: 1, cacheReadTokens: null, cacheWriteTokens: null, complete: true } }];
        if (step === 'mcp') fields.push({ type: 'tool-start', tool: { name: 'crewstation_probe_nonce' } });
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
  return { state, commands, run: () => probeBusinessProfile({ runner, taskId: newResourceId() as TaskId, input, budgetMs: 100, pollMs: 1, heartbeat: async () => true, report: async () => {} }) };
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
