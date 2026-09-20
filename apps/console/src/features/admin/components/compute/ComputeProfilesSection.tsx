import { useState, type ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiQuery } from '../../../../shared/api/useApi';
import { usePollingRefetch } from '../../../../shared/lib/usePollingRefetch';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { DataTable } from '../../../../shared/ui/DataTable';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { testRunning } from '../../model/profileStatus';
import styles from './ComputeEditor.module.css';
import { ProfileListRow } from './ProfileListRow';
import { FormField } from '../../../../shared/ui/FormField';

const COLUMNS = ['name', 'execution', 'availability', 'actions'] as const;

/**
 * 算力档位（RFC-006）：一张表就是全部配置——协议、镜像、二进制、模型、资源套餐与启动前步骤都在档位里，
 * 没有单独的运行环境。保存后服务端自动排测试，有测试在跑时按短间隔刷新，直到出结果。
 */
export function ComputeProfilesSection({ onOpen, onCreate }: { readonly onOpen: (name: string) => void; readonly onCreate: () => void }): ReactElement {
  const t = useT();
  const [search, setSearch] = useState('');
  const profiles = useApiQuery(queryKeys.adminComputeProfiles(), () => api.computeProfiles.list());
  // 修改人只有用户 ID：管理页用用户目录换成名字，读不到就显示 ID。
  const users = useApiQuery(queryKeys.users(), () => api.users.list());
  const items = profiles.data?.items ?? [];
  const matching = items.filter((item) => [item.name, item.description, item.model, item.protocol].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())));
  usePollingRefetch(profiles.refetch, 2000, items.some((item) => testRunning(item.latestTest) || item.availability.state === 'testing'));
  const who = (userId: string) => users.data?.items.find((user) => user.id === userId)?.name ?? userId;
  return (
    <Card title={t('admin.profile.title')} extra={<Button variant="primary" onClick={onCreate}>{t('admin.profile.create')}</Button>} footer={t('admin.profile.hint')}>
      <div className={styles.listToolbar}>
        <FormField label={t('admin.profile.search')}><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></FormField>
        {search ? <Button onClick={() => setSearch('')}>{t('admin.profile.clearSearch')}</Button> : null}
        <Button onClick={() => { void profiles.refetch(); }}>{t('admin.profile.refresh')}</Button>
      </div>
      <QueryStatus isPending={profiles.isPending} error={profiles.error} isEmpty={matching.length === 0} emptyTitle={t(search.trim() ? 'admin.profile.noMatches' : 'admin.profile.emptyTitle')} emptyDescription={t(search.trim() ? 'admin.profile.searchHint' : 'admin.profile.emptyDescription')} />
      {matching.length > 0 ? (
        <DataTable className={styles.profileTable} columns={COLUMNS.map((column) => t(`admin.profile.column.${column}`))}>
          {matching.map((profile) => <ProfileListRow key={profile.name} profile={profile} updatedBy={who(profile.updatedBy)} onOpen={onOpen} />)}
        </DataTable>
      ) : null}
    </Card>
  );
}
