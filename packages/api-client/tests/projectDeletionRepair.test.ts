import { expect, test } from 'bun:test';
import { createApiClient } from '../index';
import { UserIdSchema } from '@crewstation/contracts';

const project = Bun.randomUUIDv7(), actor = UserIdSchema.parse(Bun.randomUUIDv7()), item = { owner: 'gateway' as const, key: 'whole-original', title: 'Original history', originalDigest: 'a'.repeat(64), evidenceDigest: 'b'.repeat(64), facts: [], blockers: [], allowedDecisions: ['retain' as const], confirmed: null };
const request = { owner: item.owner, key: item.key, originalDigest: item.originalDigest, evidenceDigest: item.evidenceDigest, decision: 'retain' as const };
const confirmed = { ...item, confirmed: { decision: 'retain' as const, actorId: actor, confirmedAt: '2026-10-06T00:00:00.000Z' } };
test('repair reads and saves use only the current whole candidate; malformed lists, wrong project and stale/body-mismatched receipts are rejected', async () => {
  const calls: { path: string; method: string; body: unknown }[] = []; let response: unknown = { version: 'operator-confirmed/v1', projectId: project, complete: true, items: [item], blockers: [] };
  const client = createApiClient({ fetch: async (raw, init) => { calls.push({ path: new URL(String(raw), 'https://test.invalid').pathname, method: init!.method!, body: init!.body ? JSON.parse(String(init!.body)) : undefined }); return Response.json(response); } });
  expect((await client.projectDeletions.repairItems!(project)).items).toEqual([item]);
  response = confirmed; expect(await client.projectDeletions.confirmRepair!(project, request)).toEqual(confirmed);
  expect(calls).toEqual([{ path: `/v1/projects/${project}/deletion-repairs`, method: 'GET', body: undefined }, { path: `/v1/projects/${project}/deletion-repairs`, method: 'POST', body: request }]);
  for (const changed of [{ ...confirmed, key: 'other' }, { ...confirmed, owner: 'provisioning' }, { ...confirmed, originalDigest: 'c'.repeat(64) }, { ...confirmed, evidenceDigest: 'c'.repeat(64) }, { ...confirmed, confirmed: null }, { ...confirmed, confirmed: { ...confirmed.confirmed, decision: 'reclaim' } }]) {
    response = changed; await expect(client.projectDeletions.confirmRepair!(project, request)).rejects.toThrow();
  }
  response = { version: 'operator-confirmed/v1', projectId: actor, complete: true, items: [], blockers: [] }; await expect(client.projectDeletions.repairItems!(project)).rejects.toThrow('原项目');
  const count = calls.length; await expect(client.projectDeletions.confirmRepair!(project, { ...request, force: true } as never)).rejects.toThrow(); expect(calls).toHaveLength(count);
});
