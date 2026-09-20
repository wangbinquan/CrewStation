import type { ComputeProfileListItem } from '@crewstation/contracts';
import { useDateText } from '../../../../shared/lib/useDateText';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { shortDigest } from '../../model/profileStatus';
import { ProfileRowActions } from './ProfileRowActions';
import { AvailabilityBadge, TestSummaryBadge } from './ProfileStatusBadges';
import styles from './ComputeEditor.module.css';

/** 长镜像与修订资料可展开，日常扫描保留状态与操作。 */
export function ProfileListRow({ profile, updatedBy, onOpen }: { readonly profile: ComputeProfileListItem; readonly updatedBy: string; readonly onOpen: (name: string) => void }) {
  const t = useT(), date = useDateText();
  return <tr>
    <td><code>{profile.name}</code>{profile.isDefault ? <> <Badge tone="info">{t('admin.profile.defaultBadge')}</Badge></> : null}
      {profile.description ? <p className={styles.hint}>{profile.description}</p> : null}
    </td>
    <td><div className={styles.rowStack}>
      <span>{t(`admin.profile.protocol.${profile.protocol}`)}</span>
      {profile.protocol !== 'terminal' ? <code>{profile.model || t('admin.profile.modelBinaryDefault')}</code> : null}
      <span className={styles.hint}>{t('admin.profile.column.taskProfile')}：{profile.taskProfile ?? t('admin.profile.defaultTaskProfile')}</span>
      <details><summary>{t('admin.profile.configurationDetails')}</summary><dl className={styles.configurationDetails}>
        <dt>{t('admin.profile.column.image')}</dt><dd><code>{profile.image}</code><div title={profile.imageDigest}>{profile.imageDigest ? `@${shortDigest(profile.imageDigest)}` : '—'}</div></dd>
        <dt>{t('admin.profile.column.binary')}</dt><dd><code>{profile.binaryPath}</code></dd>
        <dt>{t('admin.profile.column.updated')}</dt><dd title={profile.updatedBy}>{updatedBy} · {date(profile.updatedAt)}</dd>
      </dl></details>
    </div></td>
    <td><div className={styles.rowStack}><AvailabilityBadge availability={profile.availability} /><TestSummaryBadge test={profile.latestTest} /></div></td>
    <td><ProfileRowActions profile={profile} onOpen={onOpen} /></td>
  </tr>;
}
