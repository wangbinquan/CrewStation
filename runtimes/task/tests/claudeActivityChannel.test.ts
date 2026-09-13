import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { NativeActivityEvent } from '@crewstation/contracts';
import { NativeActivityEventSchema } from '@crewstation/contracts';
import { createClaudeActivityChannel } from '../src/activity/claudeActivityChannel';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function fixture(agentId = 'agent', leaseMs?: number) {
  const events: NativeActivityEvent[] = [];
  const unavailable = Promise.withResolvers<void>();
  const channel = createClaudeActivityChannel({ agentId, terminalId: agentId, runnerId: crypto.randomUUID(), ...(leaseMs ? { leaseMs } : {}), emit: (event) => { events.push(NativeActivityEventSchema.parse(event)); if (event.signal.kind === 'source-unavailable') unavailable.resolve(); } });
  cleanup.push(() => channel.close());
  const post = (path: string, body: unknown) => fetch(`${channel.options.endpoint}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const hook = (name: string, fields: Record<string, unknown> = {}) => post('/hooks', { hook_event_name: name, session_id: 'session', prompt_id: 'prompt', ...fields });
  return { events, channel, post, hook, unavailable: unavailable.promise };
}
const attrs = (items: Record<string, string>) => Object.entries(items).map(([key, value]) => ({ key, value: { stringValue: value } }));
const resource = { attributes: attrs({ 'service.name': 'claude-code', 'service.version': '2.1.268' }) };

test('真实 HTTP、增量 transcript 与 trace 接成一次完成；重复上报不重复事件，CLI 彼此独立', async () => {
  const f = fixture(), other = fixture('other');
  const root = await mkdtemp(join(tmpdir(), 'cs-claude-channel-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'session.jsonl');
  await f.hook('SessionStart', { transcript_path: path }); await f.hook('UserPromptSubmit', { transcript_path: path });
  const base = { sessionId: 'session', version: '2.1.268' };
  await writeFile(path, [
    { ...base, uuid: 'u', parentUuid: null, type: 'user', origin: { kind: 'human' }, promptId: 'prompt' },
    { ...base, uuid: 'a', parentUuid: 'u', type: 'assistant', message: { stop_reason: 'end_turn', content: 'private answer' } },
    { ...base, uuid: 'd', parentUuid: 'a', type: 'system', subtype: 'turn_duration' },
  ].map((node) => `${JSON.stringify(node)}\n`).join(''));
  const traces = { resourceSpans: [{ resource, scopeSpans: [{ spans: [{ name: 'claude_code.interaction', traceId: 'trace', spanId: 'root', endTimeUnixNano: '100', attributes: attrs({ 'session.id': 'session', 'parent.source': 'none' }) }] }] }] };
  const logs = { resourceLogs: [{ resource, scopeLogs: [{ logRecords: [{ traceId: 'trace', spanId: 'root', attributes: attrs({ 'event.name': 'user_prompt', 'session.id': 'session', 'prompt.id': 'prompt' }) }] }] }] };
  await f.post('/v1/traces', traces); await f.post('/v1/logs', logs); await f.post('/v1/traces', traces);
  expect(f.events.map((event) => event.signal.kind)).toEqual(['source-ready', 'turn-started', 'turn-completed']);
  expect(f.events.map((event) => event.seq)).toEqual([1, 2, 3]); expect(f.events.at(-1)?.turnOrdinal).toBe(1);
  expect(JSON.stringify(f.events)).not.toContain('private answer'); expect(other.events).toEqual([]);
  f.channel.close(); f.channel.close(); expect(f.events.filter((event) => event.signal.kind === 'process-ended')).toHaveLength(1);
});

test('状态源停止心跳或送来不兼容结构明确降级，不产生成功；错误路径令牌不接受事件', async () => {
  const f = fixture('lease', 20); await f.hook('SessionStart');
  await f.unavailable;
  expect(f.events.at(-1)?.signal).toMatchObject({ kind: 'source-unavailable', reason: 'source-error' });
  const g = fixture('invalid');
  const badUrl = g.channel.options.endpoint.replace(g.channel.options.token, 'incorrect');
  expect((await fetch(`${badUrl}/hooks`, { method: 'POST', body: '{}' })).status).toBe(404);
  expect(g.events).toEqual([]);
  expect((await g.post('/hooks', { hook_event_name: 'UserPromptSubmit' })).status).toBe(400);
  expect(g.events.at(-1)?.signal.kind).toBe('source-unavailable');
  expect(g.events.some((event) => event.signal.kind === 'turn-completed')).toBe(false);
});
