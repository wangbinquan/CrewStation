import type { ConfigVersionDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { formatDateTime } from '../../../shared/lib/dateFormat';
import { useI18n } from '../../../shared/lib/useI18n';
import { useT } from '../../../shared/lib/useT';
import styles from './ConfigVersionList.module.css';

export interface ConfigVersionListProps {
  readonly versions: readonly ConfigVersionDto[];
  readonly pending: boolean;
}

/** 版本历史：版本号、写入时间与该版本包含的键；值不回显（Secret 无值可回显）。 */
export function ConfigVersionList({ versions, pending }: ConfigVersionListProps): ReactElement {
  const t = useT();
  const { locale } = useI18n();
  if (pending) return <p className={styles.muted}>{t('config.versions.loading')}</p>;
  if (versions.length === 0) return <p className={styles.muted}>{t('config.versions.empty')}</p>;
  return (
    <ol className={styles.list}>
      {versions.map((version) => (
        <li key={version.version} className={styles.row}>
          <span className={styles.version}>
            {t('config.versions.version')} {version.version}
          </span>
          <span className={styles.muted}>{formatDateTime(version.createdAt, locale)}</span>
          <span className={styles.keys} title={version.keys.join(', ')}>
            {t('config.versions.keyCount', { count: version.keys.length })}
          </span>
        </li>
      ))}
    </ol>
  );
}
