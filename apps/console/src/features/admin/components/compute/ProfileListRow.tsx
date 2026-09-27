import { CatalogCell } from '../../../../shared/ui/catalog/CatalogCell';
import type { ComputeProfileListItem } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { ProfileRowActions } from './ProfileRowActions';
import { AvailabilityBadge, TestSummaryBadge } from './ProfileStatusBadges';
import styles from '../../../../shared/ui/CapabilityCatalog.module.css';

/** 长镜像与修订资料可展开，日常扫描保留状态与操作。 */
export function ProfileListRow({ profile, taskProfileName, updatedBy, onOpen }: { readonly profile: ComputeProfileListItem; readonly taskProfileName?: string; readonly updatedBy: string; readonly onOpen: (name: string) => void }) {
  const t = useT();
  return <ProfileRowActions profile={profile} updatedBy={updatedBy} onOpen={onOpen}>{(controls, expanded) => <tr data-profile-id={profile.id} className={expanded ? styles.expandedRow : styles.profileRow}>
    <td><div className={styles.nameLine}><code>{profile.name}</code>{profile.isDefault ? <Badge tone="info">{t('admin.profile.defaultBadge')}</Badge> : null}<span className={styles.hint}>{t(profile.defaultVisible === false ? 'admin.profile.defaultHidden' : 'admin.profile.defaultVisible')}</span></div>
      {profile.description ? <p className={styles.description}>{profile.description}</p> : null}
    </td>
    <CatalogCell label={t('admin.profile.column.execution')}><div className={styles.rowStack}>
      <span>{t(`admin.profile.protocol.${profile.protocol}`)}</span>
      {profile.protocol !== 'terminal' ? <code className={styles.model}>{profile.model || t('admin.profile.modelBinaryDefault')}</code> : null}
    </div></CatalogCell>
    <CatalogCell label={t('admin.profile.column.taskProfile')}>{taskProfileName ?? t('admin.profile.defaultTaskProfile')}</CatalogCell>
    <CatalogCell label={t('admin.profile.column.availability')}><div className={styles.status}><AvailabilityBadge availability={profile.availability} /><TestSummaryBadge test={profile.latestTest} compact /></div></CatalogCell>
    <td>{controls}</td>
  </tr>}</ProfileRowActions>;
}
