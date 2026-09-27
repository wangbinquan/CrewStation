import { useState, type ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { AUTO_REFRESH, useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { DataTable } from '../../../../shared/ui/DataTable';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { testRunning } from '../../model/profileStatus';
import styles from '../../../../shared/ui/CapabilityCatalog.module.css';
import { ProfileListRow } from './ProfileListRow';
import { CatalogSearch } from '../../../../shared/ui/catalog/CatalogSearch';

const COLUMNS = ['name', 'execution', 'taskProfile', 'availability', 'actions'] as const;

/**
 * 算力档位（RFC-006）：一张表就是全部配置——协议、镜像、二进制、模型、资源套餐与启动前步骤都在档位里，
 * 没有单独的运行环境。保存后服务端自动排测试，有测试在跑时按短间隔刷新，直到出结果。
 */
export function ComputeProfilesSection({ onOpen, onCreate, search: value, onSearch }: { readonly search?: string; readonly onSearch?: (q: string) => void; readonly onOpen: (name: string) => void; readonly onCreate: () => void }): ReactElement {
  const t = useT();
  const [local, setLocal] = useState(''), search = value ?? local;
  // 档位每 30 秒在原位重读，有测试在跑时每 2 秒，直到出结果；不提供刷新按钮（2026-09-23 裁定）。
  const profiles = useApiQuery(queryKeys.adminComputeProfiles(), () => api.computeProfiles.list(), {
    refetchIntervalMs: (data) => (data?.items.some((item) => testRunning(item.latestTest) || item.availability.state === 'testing') ? 2_000 : AUTO_REFRESH.refetchIntervalMs), refetchOnWindowFocus: true });
  // 修改人只有用户 ID：管理页用用户目录换成名字，读不到就显示 ID。
  const tasks = useApiQuery(queryKeys.taskProfiles(), () => api.catalog.listTaskProfiles());
  const users = useApiQuery(queryKeys.users(), () => api.users.list());
  const items = [401, 403, 404].includes(profiles.error?.status ?? 0) ? [] : profiles.data?.items ?? [];
  const matching = items.filter((item) => [item.name, item.description, item.model, item.protocol].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())));
  const who = (userId: string) => users.data?.items.find((user) => user.id === userId)?.name ?? userId;
  return (
    <Card compact>
      <CatalogSearch key={search} value={search} label={t('admin.profile.search')} onSearch={onSearch ?? setLocal} actions={<Button variant="primary" onClick={onCreate}>{t('admin.profile.create')}</Button>} />
      <QueryStatus isPending={profiles.isPending} error={profiles.error} isEmpty={matching.length === 0} emptyTitle={t(search.trim() ? 'admin.profile.noMatches' : 'admin.profile.emptyTitle')} emptyDescription={t(search.trim() ? 'admin.profile.searchHint' : 'admin.profile.emptyDescription')} />
      {matching.length > 0 ? (
        <DataTable className={styles.profileTable} columns={COLUMNS.map((column) => t(`admin.profile.column.${column}`))}>
          {matching.map((profile) => <ProfileListRow key={profile.id} profile={profile} taskProfileName={tasks.data?.items.find((task) => task.id === profile.taskProfile)?.name} updatedBy={who(profile.updatedBy)} onOpen={onOpen} />)}
        </DataTable>
      ) : null}
      {!profiles.isPending && !profiles.error ? <p className={styles.hint}>{t('catalog.resultCount', { count: matching.length })}</p> : null}
    </Card>
  );
}
