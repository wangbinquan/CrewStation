import type { SlotDto } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { slotCanOpen, slotIdentityKnown } from '../model/deployedVersions';
import styles from './DeploymentVersions.module.css';

/** 两张版本卡：标签作标题（点击选中该发布），下面一行提交／副本，底部地址与访问入口（设计附件 §发布与上线）。 */
export function DeployedVersionCard({ role, slot, known, onSelect }: { readonly role: 'prod' | 'preview'; readonly slot?: SlotDto; readonly known: boolean; readonly onSelect: (id: string) => void }) {
  const t = useT(), identity = known && slotIdentityKnown(slot), empty = known && (!slot || slot.state === 'empty') && !slot?.releaseId;
  const state = known ? slot?.state ?? 'empty' : 'unknown';
  return <Card compact title={t(`release.versions.${role}`)} extra={<Badge tone={state === 'ready' && identity ? 'success' : ['failed', 'degraded'].includes(state) ? 'danger' : 'neutral'}>{t(`release.versions.state.${state}`)}</Badge>}>
    {empty ? <p className={styles.note}>{t('release.versions.empty')}</p> : !identity ? <p className={styles.note}>{t('release.versions.unknown')}</p> : <div className={styles.version}>
      <Button variant="ghost" className={styles.tagButton} title={t('release.versions.select')} onClick={() => onSelect(slot!.releaseId!)}>{slot!.tag}</Button>
      {/* 发布页要能核对完整 SHA，不截短。 */}
      <div className={styles.meta}><span>SHA <code>{slot!.commitSha ?? ''}</code></span><span>{t('release.versions.replicas')} {slot!.readyReplicas} / {slot!.replicas}</span></div>
      <div className={styles.footer}><span className={styles.host}>{slot!.host}</span>
        {slotCanOpen(slot) ? <a className={styles.open} href={`//${slot!.host}`} target="_blank" rel="noreferrer">{t(`release.versions.open.${role}`)}</a> : <span className={styles.note}>{t('release.traffic.notReady')}</span>}</div>
    </div>}
  </Card>;
}
