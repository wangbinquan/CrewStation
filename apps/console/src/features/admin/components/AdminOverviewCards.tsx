import type { ReactElement } from 'react';
import { ADMIN_ENTRY_GROUPS } from '../../../shared/admin/adminNavigation';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { Stack } from '../../../shared/ui/Stack';
import styles from './AdminOverviewCards.module.css';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';

/** 管理目录的紧凑入口：分组、顺序与文案键都读左栏那一份，这里只多一句用途；待处理入口由上方的待办区块承担。 */
export function AdminOverviewCards(): ReactElement {
  const t = useT();
  return (
    <Stack>
      {ADMIN_ENTRY_GROUPS.map((group) => (
        <section key={group.id} aria-labelledby={`admin-entries-${group.id}`}>
          <h2 className={styles.heading} id={`admin-entries-${group.id}`}>{t(group.titleKey)}</h2>
          <div className={styles.grid}>
            {group.pages.map((entry) => (
              <Card compact key={entry.to} title={t(entry.labelKey)}>
                <p className={styles.hint}>{t(entry.hintKey)}</p>
                <ButtonLink size="small" to={entry.to}>{t('admin.overview.open', { page: t(entry.labelKey) })}</ButtonLink>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </Stack>
  );
}
