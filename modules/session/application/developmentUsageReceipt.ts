import type { DevelopmentUsageInfo, DevelopmentUsageReceipt, StoredDevelopmentUsage } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';
import type { DevelopmentUsageStore } from '../ports/developmentUsage';

/** Original owner binding is immutable even if a new empty Runner responds after both volumes are lost. */
export async function persistDevelopmentInfo(store: DevelopmentUsageStore, stream: StoredDevelopmentUsage, info: DevelopmentUsageInfo): Promise<DevelopmentUsageReceipt | undefined> {
  const registration = stream.registration, key = registration.key;
  if (info.runtimeTaskId !== registration.runtimeTaskId) throw conflict('开发数字 info 返回了另一环境');
  if (info.journalId !== key.journalId || info.podUid !== registration.podUid || (!info.receipt && info.incarnation !== key.incarnation)) {
    await store.unavailable(registration.runtimeTaskId, { key, podUid: registration.podUid, reason: 'journal-replaced' });
    return undefined;
  }
  // A legitimate pre-start null reply can arrive after another accepted reply committed.
  // Null alone never proves lost data; only a bound explicit loss/replacement reply does.
  if (!info.receipt) return undefined;
  await store.ingest(registration.runtimeTaskId, info.receipt);
  return info.receipt;
}
