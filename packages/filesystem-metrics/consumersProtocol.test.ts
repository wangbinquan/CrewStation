import { expect, test } from 'bun:test';
import { ConsumerRequestSchema, ConsumerResponseSchema } from './consumersProtocol';
import type { ConsumerRequest, ConsumerResponse } from './consumersProtocol';

const source = { bootId: '12345678-1234-1234-1234-123456789abc', namespace: 'pid:[701]' };
const identity = { device: '18446744073709551615', inode: '9007199254740993' };

test('consumer protocol preserves exact uint64 identities and binds every observation to its captured source', () => {
  const input: ConsumerRequest = { mode: 'observe', source, identities: [identity] };
  expect(ConsumerRequestSchema.parse(input)).toEqual(input);
  expect(ConsumerRequestSchema.parse({ mode: 'capture', identities: [] })).toEqual({ mode: 'capture', identities: [] });
  for (const replacement of ['18446744073709551616', '01', '-1', '1.0', 'NaN', '']) {
    expect(ConsumerRequestSchema.safeParse({ mode: 'capture', identities: [{ ...identity, device: replacement }] }).success).toBe(false);
  }
  expect(ConsumerRequestSchema.safeParse({ ...input, source: { ...source, namespace: 'pid:[other]' } }).success).toBe(false);
  expect(ConsumerRequestSchema.safeParse({ ...input, source: { ...source, bootId: 'wrong' } }).success).toBe(false);
});

test('a complete consumer response cannot conceal unreadable sources or contradictory blockers', () => {
  const response: ConsumerResponse = { version: 1, complete: true, ...source, consumers: [{ pid: 1, tid: 2, startedTick: '3', kind: 'mapping', ...identity }], blockers: [] };
  expect(ConsumerResponseSchema.parse(response)).toEqual(response);
  for (const invalid of [
    { ...response, blockers: [{ code: 'process-unreadable', pid: 1 }] }, { ...response, namespace: '' }, { ...response, bootId: '' },
    { ...response, consumers: [{ ...response.consumers[0], contents: 'private data' }] },
  ]) expect(ConsumerResponseSchema.safeParse(invalid).success).toBe(false);
  const unavailable: ConsumerResponse = { version: 1, complete: false, bootId: '', namespace: '', consumers: [], blockers: [{ code: 'source-unreadable' }] };
  expect(ConsumerResponseSchema.parse(unavailable)).toEqual(unavailable);
});
