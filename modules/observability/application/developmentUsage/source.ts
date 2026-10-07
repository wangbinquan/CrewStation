import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { DevelopmentNativePageEvidence, DevelopmentUsagePage, DevelopmentUsageRegistration } from '@crewstation/contracts';
import { prepareDevelopmentUsagePage, prepareDevelopmentVersionRecovery } from '../developmentUsage';
import { prepareDevelopmentAdmission } from './admission';
import { developmentStreamId } from '../../domain/developmentNative';
import { prepareDevelopmentNativePacket, type DevelopmentNativePacket } from '../../domain/developmentUsage/packet';
import type { AcceptedExecutionPrice } from '../../ports/tokenPricing';
import type { DevelopmentUsageLedgerStore, DevelopmentUsageResolved, DevelopmentUsageSource } from '../../ports/developmentUsage';

export interface NativeDevelopmentPreparedPage {
  readonly kind: 'native-v2'; readonly source: DevelopmentUsagePage;
  readonly projectId: DevelopmentUsageRegistration['identity']['projectId'];
  readonly taskId: DevelopmentUsageRegistration['identity']['taskId'];
  readonly sourceId: string; readonly expectedCursor: string | null; readonly nextCursor: string;
  readonly packets: readonly DevelopmentNativePacket[]; readonly fingerprint: string;
}
/** Transport pages remain bounded; neither pass population nor retained work ends at a page boundary. */
export async function prepareDevelopmentSourcePage(raw: DevelopmentUsagePage, owner: DevelopmentUsageResolved,
  session: DevelopmentUsageRegistration, accepted: AcceptedExecutionPrice, read: DevelopmentUsageSource['nativePage']) {
  if (owner.nativeSelection?.version !== 2) return prepareDevelopmentUsagePage(raw, owner, session, accepted);
  if (raw.events.length && raw.events.every(event => event.capture.version === 1))
    return prepareDevelopmentVersionRecovery(raw, owner, session, accepted);
  const { source, registration, original } = prepareDevelopmentAdmission(raw, owner, session, accepted), choice = owner.nativeSelection;
  if (!choice.expectedNamespace || choice.expectedNamespace.length > 512 || !read) throw precondition('原生 v2 缺少冻结选择或 Session 原页读取口');
  if (source.events.some(event => event.capture.version !== 2)) throw precondition('原生 v2 来源不能混入旧帧');
  const cached = new Map<string, DevelopmentNativePageEvidence>(), packets: DevelopmentNativePacket[] = [];
  for (const event of source.events) {
    if (event.capture.version !== 2) throw precondition('原生 v2 来源不能混入旧帧');
    const ack = event.capture.nativeSource.ack, key = JSON.stringify([ack.identity.passId, ack.ordinal]);
    let page = cached.get(key);
    if (!page) {
      page = await read(source.key, ack.identity.passId, ack.ordinal);
      if (cached.size === 2) cached.delete(cached.keys().next().value!);
      cached.set(key, page);
    }
    packets.push(prepareDevelopmentNativePacket({ key: source.key, registration, ownerRegistration: original,
      selection: { version: 2, expectedNamespace: choice.expectedNamespace }, original: page, event }));
  }
  return { kind: 'native-v2', projectId: registration.identity.projectId, taskId: registration.identity.taskId,
    sourceId: developmentStreamId(registration), expectedCursor: source.after === 0 ? null : 'development:' + source.after,
    nextCursor: 'development:' + source.through, source, packets,
    fingerprint: jsonHash({ source, registration, selection: choice, price: owner.price }) } satisfies NativeDevelopmentPreparedPage;
}
export function nativeDevelopmentPageIngestion(store: DevelopmentUsageLedgerStore) {
  return (page: NativeDevelopmentPreparedPage) => store.changeDevelopment(page, page.sourceId, async tx => {
    const receipt = await tx.pageFingerprint(page.nextCursor), passKeys = [...new Set(page.packets.map(packet =>
      jsonHash({ streamSourceId: packet.streamSourceId, passId: packet.page.identity.passId })))];
    if (receipt !== undefined) {
      if (receipt !== page.fingerprint) throw conflict('开发来源页重放内容冲突');
      return { passKeys, cursor: await tx.cursor(), applied: 0, duplicate: page.packets.length };
    }
    if (await tx.cursor() !== page.expectedCursor) throw conflict('开发数值来源游标已更新');
    let applied = 0;
    for (const packet of page.packets) if (!(await tx.developmentPacket(packet)).duplicate) applied++;
    await tx.advance(page.nextCursor, page.fingerprint);
    return { passKeys, cursor: page.nextCursor, applied, duplicate: page.packets.length - applied };
  });
}
