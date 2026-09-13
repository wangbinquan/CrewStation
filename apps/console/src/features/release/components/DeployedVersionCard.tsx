import type { SlotDto } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { slotCanOpen, slotIdentityKnown } from '../model/deployedVersions';

export function DeployedVersionCard({ role, slot, known, onSelect }: { readonly role: 'prod' | 'preview'; readonly slot?: SlotDto; readonly known: boolean; readonly onSelect: (id: string) => void }) {
  const t = useT(), identity = known && slotIdentityKnown(slot), empty = known && (!slot || slot.state === 'empty') && !slot?.releaseId;
  const state = known ? slot?.state ?? 'empty' : 'unknown';
  return <Card compact title={t(`release.versions.${role}`)} extra={<Badge tone={state === 'ready' && identity ? 'success' : ['failed', 'degraded'].includes(state) ? 'danger' : 'neutral'}>{t(`release.versions.state.${state}`)}</Badge>}>
    {empty ? <p>{t('release.versions.empty')}</p> : !identity ? <p>{t('release.versions.unknown')}</p> : <>
      <Button onClick={() => onSelect(slot!.releaseId!)}>{slot!.tag}</Button>
      <DefinitionList items={[{ label: 'SHA', value: <code>{slot!.commitSha}</code> }, { label: t('release.versions.replicas'), value: `${slot!.readyReplicas} / ${slot!.replicas}` }, { label: t('release.versions.host'), value: slot!.host }]} />
      {slotCanOpen(slot) ? <a href={`//${slot!.host}`} target="_blank" rel="noreferrer">{t(`release.versions.open.${role}`)}</a> : <p>{t('release.traffic.notReady')}</p>}
    </>}
  </Card>;
}
