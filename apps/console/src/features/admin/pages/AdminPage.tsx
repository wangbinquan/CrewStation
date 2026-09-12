import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ComputeProfilesSection } from '../components/ComputeProfilesSection';
import { EgressEntriesSection } from '../components/EgressEntriesSection';
import { EgressRequestsSection } from '../components/EgressRequestsSection';
import { GatewaySection } from '../components/GatewaySection';
import { ServicePlansSection } from '../components/ServicePlansSection';
import { TaskProfilesSection } from '../components/TaskProfilesSection';
import { UsersSection } from '../components/UsersSection';
import styles from './AdminPage.module.css';

/**
 * 管理页：所有分区都只对平台管理员开放，因此先读 /v1/me 的 isAdmin，
 * 非管理员直接给出说明，而不是让每个分区各自撞 403。
 */
export function AdminPage(): ReactElement {
  const t = useT();
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const header = <PageHeader title={t('admin.title')} description={[t('admin.line1'), t('admin.line2')]} />;
  if (me.data?.isAdmin !== true) {
    return (
      <>
        {header}
        <QueryStatus isPending={me.isPending} error={me.error} />
        {me.isPending ? null : <EmptyState title={t('admin.denied.title')} description={t('admin.denied.description')} />}
      </>
    );
  }
  return (
    <>
      {header}
      <div className={styles.stack}>
        <UsersSection />
        <ServicePlansSection />
        <TaskProfilesSection />
        <ComputeProfilesSection />
        <EgressEntriesSection />
        <EgressRequestsSection />
        <GatewaySection />
      </div>
    </>
  );
}
