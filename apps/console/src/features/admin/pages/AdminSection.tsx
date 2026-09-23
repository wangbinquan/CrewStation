import type { ReactElement, ReactNode } from 'react';
import { PageHeader } from '../../../shared/ui/PageHeader';
import styles from './AdminSection.module.css';

export interface AdminSectionProps {
  readonly title: string;
  readonly description?: string | readonly string[];
  /** 本页的主动作，放在页头右侧（标准尺寸，主按钮最左）。 */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

/** 管理空间各页共用的外壳：标题＋说明＋纵向堆叠的分区。守卫在 AdminLayout，这里不再判权限。 */
export function AdminSection({ title, description, actions, children }: AdminSectionProps): ReactElement {
  return (
    <>
      <PageHeader title={title} {...(description === undefined ? {} : { description })} {...(actions === undefined ? {} : { actions })} />
      <div className={styles.stack}>{children}</div>
    </>
  );
}
