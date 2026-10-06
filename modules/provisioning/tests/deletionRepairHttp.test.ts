import { expect, test } from 'bun:test';
import type { Actor, ConfirmProjectDeletionRepair, ProjectDeletionRepairItem, ProjectDeletionTarget } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { deletionFixture } from './deletionFixture';
import { deletionOperatorRepairs } from '../application/deletion/operatorRepairs';
import { projectDeletionRoutes } from '../http/projectDeletionRoutes';

const available = await testDatabaseAvailable();
test.skipIf(!available)('repair HTTP independently rechecks current admin, strict input and all four sources; saves only its public owner without queue/deletion side effects', async () => {
  const f = await deletionFixture();
  try {
    const p = await f.create(), calls: string[] = []; let unavailable = false;
    const item: ProjectDeletionRepairItem = { owner: 'gateway', key: 'whole-history', title: 'Whole unknown history', originalDigest: 'a'.repeat(64), evidenceDigest: 'b'.repeat(64), facts: [], allowedDecisions: ['retain'], blockers: [], confirmed: null };
    const owners = f.external.owners.map((owner) => !['business-task', 'gateway', 'provisioning', 'data-control'].includes(owner.participant) ? owner : { ...owner, repairs: {
      inspect: async () => { calls.push('read:' + owner.participant); if (unavailable && owner.participant === 'gateway') throw new Error('private unavailable'); return owner.participant === 'gateway' ? [item] : []; },
      confirm: async (target: ProjectDeletionTarget, actor: Actor, input: ConfirmProjectDeletionRepair) => { calls.push('save:' + owner.participant); expect(target.id).toBe(p.id); expect(actor.isAdmin).toBe(true); expect(input.key).toBe(item.key); return { ...item, confirmed: { decision: input.decision, actorId: actor.userId, confirmedAt: '2026-10-06T00:00:00.000Z' } }; },
    } });
    const repairs = deletionOperatorRepairs(f.intents, owners, async (id) => id === f.admin.userId);
    const http = createApp({ name: 'repair-test' }).route('/', projectDeletionRoutes({ ...f.controller, repairs }, async (id) => id === f.admin.userId));
    const path = `/v1/projects/${p.id}/deletion-repairs`, request = { owner: item.owner, key: item.key, originalDigest: item.originalDigest, evidenceDigest: item.evidenceDigest, decision: 'retain' };
    const call = (method: string, actor = f.admin.userId, body?: unknown) => http.request(path, { method, headers: { 'content-type': 'application/json', [IDENTITY_HEADERS.userId]: actor }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect((await call('GET', f.member.userId)).status).toBe(403); expect((await call('POST', f.member.userId, request)).status).toBe(403); expect(calls).toEqual([]);
    await expect(repairs.confirm({ ...f.member, isAdmin: true }, p.id, request as never)).rejects.toThrow();
    const read = await call('GET'); expect(read.headers.get('cache-control')).toBe('no-store'); expect(await read.json()).toMatchObject({ complete: true, projectId: p.id, items: [item] }); expect(calls).toHaveLength(4);
    expect((await call('POST', f.admin.userId, { ...request, force: true })).status).toBe(400); expect(calls).toHaveLength(4);
    expect((await call('POST', f.admin.userId, request)).status).toBe(200); expect(calls.at(-1)).toBe('save:gateway'); expect(calls.filter((entry) => entry.startsWith('save:'))).toEqual(['save:gateway']);
    unavailable = true; expect(await (await call('GET')).json()).toMatchObject({ complete: false, items: [] });
    expect(f.queued).toEqual([]); expect(f.external.calls).toEqual([]); expect((await f.api.getProject(f.admin, p.id)).state).toBe(p.state);
    const missing = deletionOperatorRepairs(f.intents, [], async () => true); expect((await missing.inspect(f.admin, p.id)).blockers).toHaveLength(4); await expect(missing.confirm(f.admin, p.id, request as never)).rejects.toThrow();
  } finally { await f.database.drop(); }
});
