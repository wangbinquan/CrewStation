import type { ReleaseDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { ReleaseStatusBadge } from './ReleaseStatusBadge';
import styles from './ReleaseHistoryCard.module.css';

/** 一次发布一行；失败时紧跟一行 message，说明卡在构建、迁移还是部署。 */
export function ReleaseRow({ release }: { readonly release: ReleaseDto }): ReactElement {
  const t = useT();
  const dateText = useDateText();
  return (
    <>
      <tr>
        <td>
          <code>{release.tag}</code>
        </td>
        <td>
          <ReleaseStatusBadge status={release.status} />
          {release.slot === undefined ? null : <span className={styles.slot}>{release.slot}</span>}
        </td>
        <td>
          <code>{release.commitSha.slice(0, 7)}</code>
        </td>
        <td>{release.branch}</td>
        <td className={styles.image}>{release.image ?? '—'}</td>
        <td className={styles.nowrap}>{dateText(release.createdAt)}</td>
      </tr>
      {release.status === 'failed' && release.message !== undefined ? (
        <tr>
          <td className={styles.failure} colSpan={6}>
            {t('release.history.failureLabel')}
            {release.message}
          </td>
        </tr>
      ) : null}
    </>
  );
}
