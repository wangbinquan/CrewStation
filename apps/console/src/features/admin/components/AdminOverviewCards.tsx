import { Fragment, type ReactElement } from 'react';
import { ADMIN_ENTRY_GROUPS, type AdminPagePath } from '../../../shared/admin/adminNavigation';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { Stack } from '../../../shared/ui/Stack';
import styles from './AdminOverviewCards.module.css';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';

export interface AdminOverviewCardsProps {
  /** app 装配带实时摘要的入口卡片；分组和位置仍由管理导航定义。 */
  readonly entryCards?: Readonly<Partial<Record<AdminPagePath, ReactElement>>>;
}

/** 管理目录的紧凑入口：分组、顺序与文案键都读左栏那一份；待处理入口由上方的待办区块承担。 */
export function AdminOverviewCards({ entryCards }: AdminOverviewCardsProps): ReactElement {
  const t = useT();
  return (
    <Stack>
      {ADMIN_ENTRY_GROUPS.map((group) => (
        <section key={group.id} aria-labelledby={`admin-entries-${group.id}`}>
          <h2 className={styles.heading} id={`admin-entries-${group.id}`}>{t(group.titleKey)}</h2>
          <div className={styles.grid}>
            {group.pages.map((entry) => (
              <Fragment key={entry.to}>
                {entryCards?.[entry.to] ?? <Card compact title={t(entry.labelKey)} actions={<ButtonLink to={entry.to}>{t('admin.overview.open', { page: t(entry.labelKey) })}</ButtonLink>}>
                  <p className={styles.hint}>{t(entry.hintKey)}</p>
                </Card>}
              </Fragment>
            ))}
          </div>
        </section>
      ))}
    </Stack>
  );
}
