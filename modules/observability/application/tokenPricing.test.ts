import { describe, expect, test } from 'bun:test';
import type { Actor, SaveTokenPrice, TokenPriceVersion, UserId } from '@crewstation/contracts';
import { fixedClock } from '@crewstation/kernel';
import { tokenPricingUseCases } from './tokenPricing';
import type { PricingProfile, TokenPriceReceipt, TokenPriceStore } from '../ports/tokenPricing';

const actor: Actor = { userId: '01a0bf5d-8f4b-7793-867c-efd7527b386b' as UserId, isAdmin: true };
const profileId = '01a0bf5d-8f4b-7178-82e1-9a99060b1192';
const profile: PricingProfile = { id: profileId, name: 'runtime', revision: 2, protocol: 'opencode', model: 'model-a' };
function input(patch: Partial<SaveTokenPrice> = {}): SaveTokenPrice {
  return { expectedRevision: 0, requestKey: 'request-0001', profileRevision: 2, protocol: 'opencode', provider: 'example',
    model: 'model-a', condition: null, currency: 'CNY', rates: { input: '0.1', cacheRead: '0', cacheWrite: null, output: '1.2' },
    effectiveFrom: '2026-09-29T00:00:00.000Z', sourceNote: 'test tariff', ...patch };
}
function fixture() {
  let versions: TokenPriceVersion[] = [], receipts = new Map<string, TokenPriceReceipt>();
  const profiles = [profile];
  const store: TokenPriceStore = {
    select: async (input) => versions.findLast((v) => v.profileId === input.profileId && v.profileRevision === input.profileRevision && v.protocol === input.protocol && v.provider === input.provider && v.model === input.model && v.condition === input.condition && Date.parse(v.effectiveFrom) <= Date.parse(input.acceptedAt)),
    heads: async (ids) => new Map(ids.map((id) => [id, versions.filter((v) => v.profileId === id).at(-1)?.revision ?? 0])),
    history: async (id, q) => versions.filter((v) => v.profileId === id && (q.beforeRevision === undefined || v.revision < q.beforeRevision)).toReversed().slice(0, q.limit),
    change: async (_id, work) => {
      const before = [...versions], saved = new Map(receipts);
      try { return await work({
        head: async (id) => versions.filter((v) => v.profileId === id).at(-1)?.revision ?? 0,
        receipt: async (id, key) => receipts.get(id + ':' + key),
        latestMatch: async (id, draft) => versions.findLast((v) => v.profileId === id && v.profileRevision === draft.profileRevision && v.protocol === draft.protocol && v.provider === draft.provider && v.model === draft.model && v.condition === draft.condition),
        append: async (version, key, fingerprint) => { versions.push(version); receipts.set(version.profileId + ':' + key, { version, fingerprint }); },
      }); } catch (error) { versions = before; receipts = saved; throw error; }
    },
  };
  const api = tokenPricingUseCases({ store, profiles: { list: async () => profiles }, clock: fixedClock('2026-09-28T00:00:00Z') });
  return { api, profiles, rows: () => versions };
}
describe('RFC-034 immutable CNY token prices', () => {
  test('append, exact decimals, idempotent retry, bounded history and unchanged runtime profile', async () => {
    const f = fixture(), original = structuredClone(f.profiles), draft = input();
    expect((await f.api.pricingProfiles(actor)).items[0]?.pricingRevision).toBe(0);
    const v1 = await f.api.savePrice(actor, profileId, draft);
    expect(v1).toMatchObject({ revision: 1, currency: 'CNY', rates: draft.rates, createdBy: actor.userId });
    expect(await f.api.savePrice(actor, profileId, draft)).toEqual(v1);
    expect(f.rows()).toHaveLength(1);
    await f.api.savePrice(actor, profileId, input({ expectedRevision: 1, requestKey: 'request-0002', effectiveFrom: '2026-09-30T00:00:00.000Z' }));
    const first = await f.api.priceHistory(actor, profileId, { limit: 1 });
    expect(first).toMatchObject({ revision: 2, nextBeforeRevision: 2, items: [{ revision: 2 }] });
    expect(await f.api.priceHistory(actor, profileId, { limit: 1, beforeRevision: 2 })).toMatchObject({ revision: 2, items: [{ revision: 1 }] });
    expect(f.profiles).toEqual(original);
    expect(f.rows()[0]).toEqual(v1);
    expect((await f.api.pricingProfiles(actor)).items[0]?.pricingRevision).toBe(2);
  });
  test('stale editors, reused request keys and mismatched profile revisions conflict', async () => {
    const f = fixture();
    await f.api.savePrice(actor, profileId, input());
    await expect(f.api.savePrice(actor, profileId, input({ sourceNote: 'different' }))).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.api.savePrice(actor, profileId, input({ requestKey: 'stale-0001' }))).rejects.toMatchObject({ kind: 'conflict', details: { revision: 1 } });
    await expect(f.api.savePrice(actor, profileId, input({ requestKey: 'changed-001', profileRevision: 3 }))).rejects.toMatchObject({ kind: 'conflict', details: { code: 'profile_revision_conflict', profileRevision: 2 } });
    await expect(f.api.savePrice(actor, profileId, input({ requestKey: 'changed-002', protocol: 'claude-code' }))).rejects.toMatchObject({ kind: 'conflict' });
    expect(f.rows()).toHaveLength(1);
  });
  test('no implicit model fallback or overlapping activation; historical records survive profile removal', async () => {
    const f = fixture();
    const v1 = await f.api.savePrice(actor, profileId, input());
    await expect(f.api.savePrice(actor, profileId, input({ requestKey: 'request-0002', expectedRevision: 1 }))).rejects.toMatchObject({ kind: 'conflict' });
    const v2 = await f.api.savePrice(actor, profileId, input({ requestKey: 'request-0003', expectedRevision: 1, model: 'model-b' }));
    expect(v2.model).toBe('model-b');
    f.profiles.splice(0);
    expect((await f.api.priceHistory(actor, profileId, { limit: 50 })).items).toEqual([v2, v1]);
    expect(await f.api.savePrice(actor, profileId, input())).toEqual(v1);
    await expect(f.api.savePrice(actor, profileId, input({ requestKey: 'gone-0001', expectedRevision: 2 }))).rejects.toMatchObject({ kind: 'not_found' });
  });
  test('only admin, CNY, nonnegative exact rates and future activation are accepted', async () => {
    const f = fixture(), member = { ...actor, isAdmin: false };
    await expect(f.api.pricingProfiles(member)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.api.priceHistory(member, profileId, { limit: 50 })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.api.savePrice(member, profileId, input())).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.api.savePrice(actor, profileId, input({ effectiveFrom: '2026-09-27T00:00:00Z' }))).rejects.toMatchObject({ kind: 'validation' });
    for (const rate of ['-1', '1e6', '0.0000001']) await expect(f.api.savePrice(actor, profileId, input({ rates: { ...input().rates, input: rate } }))).rejects.toMatchObject({ kind: 'validation' });
    await expect(f.api.savePrice(actor, profileId, { ...input(), currency: 'USD' } as unknown as SaveTokenPrice)).rejects.toMatchObject({ kind: 'validation' });
    expect(f.rows()).toHaveLength(0);
  });
});
