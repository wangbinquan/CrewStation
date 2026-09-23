import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { AutoOfflineSettingsCard } from '../components/settings/AutoOfflineSettingsCard';
import { AdminSection } from './AdminSection';

/** 平台设置（RFC-021 M28）：平台级参数，保存后对所有项目生效；目前只有待验证版本自动下线的时长。 */
export function AdminSettingsPage(): ReactElement {
  const t = useT();
  return (
    <AdminSection title={t('nav.admin.settings')} description={t('admin.settings.hint')}>
      <AutoOfflineSettingsCard />
    </AdminSection>
  );
}
