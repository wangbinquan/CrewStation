import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { TaskProfilesSection } from '../components/TaskProfilesSection';
import { AdminSection } from './AdminSection';

export function AdminTaskProfilesPage(): ReactElement {
  const t = useT();
  return (
    <AdminSection title={t('nav.admin.taskProfiles')} description={t('admin.profiles.hint')}>
      <TaskProfilesSection />
    </AdminSection>
  );
}
