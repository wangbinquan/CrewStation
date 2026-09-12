import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { UsersSection } from '../components/UsersSection';
import { AdminSection } from './AdminSection';

export function AdminUsersPage(): ReactElement {
  const t = useT();
  return (
    <AdminSection title={t('nav.admin.users')} description={t('admin.users.hint')}>
      <UsersSection />
    </AdminSection>
  );
}
