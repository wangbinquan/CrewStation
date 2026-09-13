import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import styles from './AdminOverviewCards.module.css';

type AdminPagePath =
  | '/admin/projects' | '/admin/users' | '/admin/compute' | '/admin/service-plans' | '/admin/task-profiles'
  | '/admin/capabilities' | '/admin/requests' | '/admin/egress' | '/admin/gateway';

/** 与左栏保持相同顺序和文案键，这里附带每个入口的用途。 */
const ENTRIES: readonly { readonly to: AdminPagePath; readonly labelKey: string; readonly hintKey: string }[] = [
  { to: '/admin/projects', labelKey: 'nav.admin.projects', hintKey: 'admin.directory.description' },
  { to: '/admin/users', labelKey: 'nav.admin.users', hintKey: 'admin.overview.users' },
  { to: '/admin/compute', labelKey: 'nav.admin.compute', hintKey: 'admin.overview.compute' },
  { to: '/admin/service-plans', labelKey: 'nav.admin.servicePlans', hintKey: 'admin.overview.servicePlans' },
  { to: '/admin/task-profiles', labelKey: 'nav.admin.taskProfiles', hintKey: 'admin.overview.taskProfiles' },
  { to: '/admin/capabilities', labelKey: 'nav.admin.capabilities', hintKey: 'admin.capabilities.hint' },
  { to: '/admin/requests', labelKey: 'nav.admin.requests', hintKey: 'admin.requests.hint' },
  { to: '/admin/egress', labelKey: 'nav.admin.egress', hintKey: 'admin.overview.egress' },
  { to: '/admin/gateway', labelKey: 'nav.admin.gateway', hintKey: 'admin.overview.gateway' },
];

/** 管理目录的紧凑入口；当前待办由独立来源展示。 */
export function AdminOverviewCards(): ReactElement {
  const t = useT();
  return (
    <div className={styles.grid}>
      {ENTRIES.map((entry) => (
        <Card compact key={entry.to} title={t(entry.labelKey)}>
          <p className={styles.hint}>{t(entry.hintKey)}</p>
          <Link to={entry.to}>{t('admin.overview.open', { page: t(entry.labelKey) })}</Link>
        </Card>
      ))}
    </div>
  );
}
