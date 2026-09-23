import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { AutoOfflineSettingsCard } from '../components/settings/AutoOfflineSettingsCard';
import { RateLimitSettingsCard } from '../components/settings/RateLimitSettingsCard';
import { AdminSection } from './AdminSection';

/** 平台设置（RFC-021 M28、RFC-025 T10）：平台级参数，保存后对所有项目生效——待验证版本自动下线的时长、网关限流。 */
export function AdminSettingsPage(): ReactElement {
  const t = useT();
  return (
    <AdminSection title={t('nav.admin.settings')} description={t('admin.settings.hint')}>
      <AutoOfflineSettingsCard />
      <RateLimitSettingsCard />
    </AdminSection>
  );
}
