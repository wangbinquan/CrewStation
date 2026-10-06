import {
  DevelopmentNativePageEvidenceSchema, DevelopmentUsageEventSchema,
  DevelopmentUsageKeySchema, DevelopmentUsageRegistrationSchema, NativeUsagePassPageSchema,
  type DevelopmentNativePageEvidence, type DevelopmentUsageEvent, type DevelopmentUsageKey,
  type DevelopmentUsageRegistration, type NativeUsagePassPage,
} from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import { developmentStreamId } from '../developmentNative';

export interface DevelopmentNativePacketInput {
  key: DevelopmentUsageKey; event: DevelopmentUsageEvent;
  registration: DevelopmentUsageRegistration; ownerRegistration: DevelopmentUsageRegistration;
  selection?: { version: 1 | 2; expectedNamespace: string };
  original: DevelopmentNativePageEvidence;
}
/** Original-page references only; numeric attribution still belongs to the one usage ledger. */
export interface DevelopmentNativePacket {
  key: DevelopmentUsageKey; registration: DevelopmentUsageRegistration;
  selection: { version: 2; expectedNamespace: string }; event: DevelopmentUsageEvent;
  original: DevelopmentNativePageEvidence; page: NativeUsagePassPage;
  packetIndex: number; packetCount: number; measurements: NativeUsagePassPage['steps'];
  streamSourceId: string; fingerprint: string;
}
/** Qualify one transport packet against the independently persisted original page. */
export function prepareDevelopmentNativePacket(input: DevelopmentNativePacketInput): DevelopmentNativePacket {
  const key = DevelopmentUsageKeySchema.parse(input.key);
  const registration = DevelopmentUsageRegistrationSchema.parse(input.registration);
  const owner = DevelopmentUsageRegistrationSchema.parse(input.ownerRegistration);
  const event = DevelopmentUsageEventSchema.parse(input.event);
  const original = DevelopmentNativePageEvidenceSchema.parse(input.original);
  const choice = input.selection;
  if (!choice || choice.version !== 2 || !choice.expectedNamespace)
    throw precondition('原生分页采集缺少冻结的 v2 来源选择');
  if (event.capture.version !== 2) throw precondition('原生分页准备只接收实际 v2 原帧');
  if (jsonHash(registration) !== jsonHash(owner) || jsonHash(key) !== jsonHash(registration.key) ||
      jsonHash(key) !== jsonHash(original.key) || original.podUid !== registration.podUid)
    throw conflict('原生分页必须属于独立登记的同一执行和 Pod');
  const source = event.capture.nativeSource;
  if (jsonHash(source.ack) !== jsonHash(original.ack) ||
      source.turnIndex !== original.preparation.turnIndex ||
      source.ack.identity.lineageKey !== choice.expectedNamespace)
    throw conflict('原生分页帧与原页 ACK、轮次或冻结命名空间不符');
  const page = NativeUsagePassPageSchema.parse(JSON.parse(original.document));
  const packetCount = Math.max(1, Math.ceil(page.steps.length / 100));
  const measurements = page.steps.slice(source.packetIndex * 100, (source.packetIndex + 1) * 100);
  if (source.packetCount !== packetCount || source.packetIndex >= packetCount ||
      jsonHash(event.capture.measurements) !== jsonHash(measurements))
    throw conflict('原生分页帧必须逐条保留原页对应片段的全部字段');
  const selection = { version: 2 as const, expectedNamespace: choice.expectedNamespace };
  return { key, registration, selection, event, original, page,
    packetIndex: source.packetIndex, packetCount, measurements,
    streamSourceId: developmentStreamId(registration),
    fingerprint: jsonHash({ key, registration, selection, event, original }) };
}
