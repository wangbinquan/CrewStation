import { ReleaseDtoSchema, SlotDtoSchema } from '@crewstation/contracts';
import type { ReleaseDto, SlotDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { slotCanOpen, slotIdentityKnown } from '../../../shared/project/deployedSlot';
export { slotCanOpen, slotIdentityKnown };

export interface DeployedVersions { prod?: SlotDto; preview?: SlotDto }
export interface TrafficSnapshot { prod?: ReleaseDto; target: ReleaseDto; checkedAt: string; rollback: boolean }

export function deployedVersions(items: readonly SlotDto[]): DeployedVersions {
  if (!Array.isArray(items)) throw new Error('release.versions.inconsistent');
  const slots = items.map((item) => { const result = SlotDtoSchema.safeParse(item); if (!result.success) throw new Error('release.versions.inconsistent'); return result.data; });
  if (!slots.length) return {};
  const prod = slots.find((slot) => slot.name === 'prod'), preview = slots.find((slot) => slot.name === 'preview');
  if (slots.length !== 2 || !prod?.active || !preview || preview.active) throw new Error('release.versions.inconsistent');
  return { prod, preview };
}
export function trafficSnapshotMatches(snapshot: TrafficSnapshot, versions: DeployedVersions): boolean {
  return (versions.prod?.releaseId ?? null) === (snapshot.prod?.id ?? null) && versions.prod?.commitSha === snapshot.prod?.commitSha &&
    versions.preview?.releaseId === snapshot.target.id && versions.preview.commitSha === snapshot.target.commitSha && slotCanOpen(versions.preview);
}
/** 只确认实际两个部署；历史 ready 记录本身不等于当前可试用／回退的目标。 */
export async function loadTrafficSnapshot(serviceId: string): Promise<TrafficSnapshot> {
  const { prod, preview } = deployedVersions((await api.services.listSlots(serviceId)).items);
  if (!slotCanOpen(preview)) throw new Error('release.traffic.notReady');
  if (!prod || (!prod.releaseId && prod.state !== 'empty') || (prod.releaseId && !slotIdentityKnown(prod))) throw new Error('release.versions.inconsistent');
  const read = async (slot: SlotDto): Promise<ReleaseDto> => {
    const parsed = ReleaseDtoSchema.safeParse(await api.services.getRelease(slot.releaseId!));
    if (!parsed.success) throw new Error('release.versions.inconsistent'); const release = parsed.data;
    if (release.id !== slot.releaseId || release.serviceId !== serviceId || release.commitSha !== slot.commitSha || release.tag !== slot.tag || !slotIdentityKnown(slot)) throw new Error('release.versions.inconsistent');
    return release;
  };
  const [current, target] = await Promise.all([prod.releaseId ? read(prod) : undefined, read(preview!)]);
  if (target.status !== 'ready') throw new Error('release.traffic.notReady');
  return { prod: current, target, checkedAt: new Date().toISOString(), rollback: !!current && Date.parse(target.createdAt) < Date.parse(current.createdAt) };
}
