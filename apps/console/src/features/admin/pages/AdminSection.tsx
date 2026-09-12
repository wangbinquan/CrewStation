import type { ReactElement, ReactNode } from 'react';
import { PageHeader } from '../../../shared/ui/PageHeader';
import styles from './AdminSection.module.css';

export interface AdminSectionProps {
  readonly title: string;
  readonly description?: string | readonly string[];
  readonly children: ReactNode;
}

/** 管理空间各页共用的外壳：标题＋说明＋纵向堆叠的分区。守卫在 AdminLayout，这里不再判权限。 */
export function AdminSection({ title, description, children }: AdminSectionProps): ReactElement {
  return (
    <>
      <PageHeader title={title} {...(description === undefined ? {} : { description })} />
      <div className={styles.stack}>{children}</div>
    </>
  );
}
