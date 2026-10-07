import type { TestDatabase } from '../../../packages/testkit';
import type { Actor, DevelopmentUsageRegistration, SaveTokenPrice } from '../../../packages/contracts';
import { systemClock, fixedClock } from '../../../packages/kernel';
import { drizzleExecutionPricing, drizzleTokenPriceStore } from '../../../modules/observability/adapters/persistence/drizzleTokenPricing';
import { drizzleUsageLedger, drizzleExecutionValuations } from '../../../modules/observability/adapters/persistence/drizzleUsageLedger';
import { tokenPricingUseCases } from '../../../modules/observability/application/tokenPricing';
import { executionValuations } from '../../../modules/observability/application/executionValuations';
import { valueDevelopmentMeter } from '../../../modules/observability/application/developmentUsage/developmentValuationRefs';
import { nativeDevelopmentWork } from '../../../modules/observability/application/developmentUsage/nativeDevelopmentWork';
import type { NativeOriginalPageReader } from '../../../modules/observability/ports/nativeDevelopmentLedger';
import { numericModel } from './nativeNumericFixture';

export async function nativeNumericPrice(database: TestDatabase, registration: DevelopmentUsageRegistration, inputRate = '2') {
  const actor: Actor = { userId: Bun.randomUUIDv7() as Actor['userId'], isAdmin: true };
  const profile = { id: registration.profileId, revision: registration.profileRevision, protocol: 'opencode' as const };
  const acceptedClock = fixedClock(systemClock.now().toISOString());
  const api = tokenPricingUseCases({ store: drizzleTokenPriceStore(database.db), clock: acceptedClock,
    profiles: { list: async () => [{ ...profile, name: '验收专用原生算力（不代表供应商账单）', model: 'configured-model-unused' }] } });
  const price: SaveTokenPrice = { expectedRevision: 0, requestKey: 'native-acceptance-' + profile.id,
    profileRevision: profile.revision, protocol: profile.protocol, ...numericModel, currency: 'CNY',
    rates: { input: inputRate, cacheRead: '0.5', cacheWrite: '3', output: '8' }, effectiveFrom: acceptedClock.now().toISOString(),
    sourceNote: 'ACCEPTANCE-ONLY-CNY-NOT-SUPPLIER-BILL' };
  const original = await api.savePrice(actor, profile.id, price), pricing = drizzleExecutionPricing(database.db);
  await pricing.accept({ identity: registration.identity, profile }, acceptedClock.now());
  return { actor, api, price, profile, original, pricing };
}
export function nativeNumericWorker(database: TestDatabase, read: NativeOriginalPageReader) {
  const ledger = drizzleUsageLedger(database.db), values = drizzleExecutionValuations(database.db);
  const value = valueDevelopmentMeter({ models: ledger, store: values,
    value: executionValuations({ store: values, pricing: drizzleExecutionPricing(database.db), clock: systemClock }) });
  return { ledger, value, work: nativeDevelopmentWork({ store: ledger, read, now: () => systemClock.now().toISOString(),
    value: async refs => { for (const ref of refs) await value(ref); } }) };
}
