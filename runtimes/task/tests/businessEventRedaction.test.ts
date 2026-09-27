import { expect, test } from 'bun:test';
import type { AgentEvent } from '@crewstation/contracts';
import { redactBusinessEvents } from '../src/agents/businessEventRedaction';

test('credentials split across text frames, tool payloads and errors never enter public events', async () => {
  const base = { agentId: 'agent', at: new Date().toISOString() };
  const input: AgentEvent[] = [
    { ...base, seq: 1, type: 'started', raw: { secret: 'private-token' } },
    { ...base, seq: 2, type: 'text', text: 'prefix private-' },
    { ...base, seq: 3, type: 'status', status: 'running' },
    { ...base, seq: 4, type: 'text', text: 'token suffix' },
    { ...base, seq: 5, type: 'tool-start', tool: { callId: 'call', name: 'shell', input: { command: 'echo private-token' } } },
    { ...base, seq: 6, type: 'error', error: { code: 'driver_error', message: 'credential private-token failed' }, result: { durationMs: 1, summary: 'private-token' } },
  ];
  const events = await Array.fromAsync(redactBusinessEvents((async function* () { yield* input; })(), ['private-token']));
  expect(events.filter((event) => event.type === 'text').map((event) => event.text).join('')).toBe('prefix *** suffix');
  expect(JSON.stringify(events)).not.toContain('private-token'); expect(JSON.stringify(events)).not.toContain('raw');
  expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
});
