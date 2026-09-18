import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiQuery } from '../../../../shared/api/useApi';
import { useDateText } from '../../../../shared/lib/useDateText';
import { usePollingRefetch } from '../../../../shared/lib/usePollingRefetch';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { DataTable } from '../../../../shared/ui/DataTable';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { shortDigest, testRunning } from '../../model/profileStatus';
import styles from './ComputeEditor.module.css';
import { ProfileRowActions } from './ProfileRowActions';
import { AvailabilityBadge, TestSummaryBadge } from './ProfileStatusBadges';

const COLUMNS = ['name', 'protocol', 'image', 'binary', 'model', 'taskProfile', 'availability', 'latestTest', 'updated', 'actions'] as const;

/**
 * 算力档位（RFC-006）：一张表就是全部配置——协议、镜像、二进制、模型、资源套餐与启动前步骤都在档位里，
 * 没有单独的运行环境。保存后服务端自动排测试，有测试在跑时按短间隔刷新，直到出结果。
 */
export function ComputeProfilesSection({ onOpen, onCreate }: { readonly onOpen: (name: string) => void; readonly onCreate: () => void }): ReactElement {
  const t = useT(), date = useDateText();
  const profiles = useApiQuery(queryKeys.adminComputeProfiles(), () => api.computeProfiles.list());
  // 修改人只有用户 ID：管理页用用户目录换成名字，读不到就显示 ID。
  const users = useApiQuery(queryKeys.users(), () => api.users.list());
  const items = profiles.data?.items ?? [];
  usePollingRefetch(profiles.refetch, 2000, items.some((item) => testRunning(item.latestTest) || item.availability.state === 'testing'));
  const who = (userId: string) => users.data?.items.find((user) => user.id === userId)?.name ?? userId;
  return (
    <Card title={t('admin.profile.title')} extra={<Button variant="primary" onClick={onCreate}>{t('admin.profile.create')}</Button>} footer={t('admin.profile.hint')}>
      <QueryStatus isPending={profiles.isPending} error={profiles.error} isEmpty={items.length === 0} emptyTitle={t('admin.profile.emptyTitle')} emptyDescription={t('admin.profile.emptyDescription')} />
      {items.length > 0 ? (
        <DataTable columns={COLUMNS.map((column) => t(`admin.profile.column.${column}`))}>
          {items.map((profile) => (
            <tr key={profile.name}>
              <td><code>{profile.name}</code>{profile.isDefault ? <> <Badge tone="info">{t('admin.profile.defaultBadge')}</Badge></> : null}{profile.description ? <div className={styles.hint}>{profile.description}</div> : null}</td>
              <td>{t(`admin.profile.protocol.${profile.protocol}`)}</td>
              <td><code className={styles.breakable}>{profile.image}</code><div className={styles.hint} title={profile.imageDigest}>{profile.imageDigest ? `@${shortDigest(profile.imageDigest)}` : '—'}</div></td>
              <td><code className={styles.breakable}>{profile.binaryPath}</code></td>
              <td>{profile.protocol === 'terminal' ? '—' : profile.model ? <code>{profile.model}</code> : t('admin.profile.modelBinaryDefault')}</td>
              <td>{profile.taskProfile ?? t('admin.profile.defaultTaskProfile')}</td>
              <td><AvailabilityBadge availability={profile.availability} /></td>
              <td><TestSummaryBadge test={profile.latestTest} /></td>
              <td><span className={styles.hint} title={profile.updatedBy}>{who(profile.updatedBy)} · {date(profile.updatedAt)}</span></td>
              <td><ProfileRowActions profile={profile} onOpen={onOpen} /></td>
            </tr>
          ))}
        </DataTable>
      ) : null}
    </Card>
  );
}
