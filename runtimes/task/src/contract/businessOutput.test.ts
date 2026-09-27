import { expect, test } from 'bun:test';
import type { AgentEvent } from '@crewstation/contracts';
import { BusinessOutputMaterialSchema } from '@crewstation/contracts';
import type { BusinessFiles } from '../files/businessFiles';
import { verifyBusinessOutput, withBusinessOutput } from './businessOutput';

function fixture(text: string, nextOffset: number | null = null) {
  const paths: string[] = [];
  const files: BusinessFiles = { read: async (query) => { paths.push(query.path); return { path: query.path, size: text.length, offset: 0, version: 'a'.repeat(64), contentBase64: Buffer.from(text).toString('base64'), nextOffset }; }, list: async () => { throw new Error('not used'); } };
  return { paths, files };
}
test('fixed inline schema validates cwd-relative JSON without reading schema from workspace; missing, oversized and malformed fail', async () => {
  const contract = { id: 'contract', required: ['result.json'], schemaDocument: JSON.stringify({ type: 'object', required: ['answer'], properties: { answer: { type: 'number' } } }) };
  const valid = fixture('{"answer":42}'); expect(await verifyBusinessOutput(valid.files, 'iso/node', contract)).toBe(true);
  expect(valid.paths).toEqual(['iso/node/result.json']);
  for (const f of [fixture('{}'), fixture('no-json'), fixture('{"answer":42}', 1)]) expect(await verifyBusinessOutput(f.files, '.', contract)).toBe(false);
  expect(await verifyBusinessOutput(valid.files, '.', { ...contract, schemaDocument: 'null' })).toBe(false);
  expect(await verifyBusinessOutput({ ...valid.files, read: async () => { throw new Error('path_denied'); } }, '.', contract)).toBe(false);
  expect(BusinessOutputMaterialSchema.safeParse({ id: 'contract', required: ['../escape.json'] }).success).toBe(false);
});
test('validation happens after stream drain, changes final event to failure, and does not run for cancelled Agent', async () => {
  let drained = false, calls = 0;
  const event: AgentEvent = { agentId: 'agent', seq: 1, at: new Date().toISOString(), type: 'completed', result: { exitCode: 0 } };
  async function* input() { yield event; drained = true; }
  const result = [];
  for await (const next of withBusinessOutput(input(), async () => { expect(drained).toBe(true); calls++; return false; })) result.push(next);
  expect(result[0]).toMatchObject({ type: 'error', error: { code: 'output_contract_failed' }, result: { exitCode: 1 } });
  async function* cancelled() { yield { ...event, type: 'cancelled' as const }; }
  for await (const next of withBusinessOutput(cancelled(), async () => { calls++; return true; })) expect(next.type).toBe('cancelled');
  expect(calls).toBe(1);
});
