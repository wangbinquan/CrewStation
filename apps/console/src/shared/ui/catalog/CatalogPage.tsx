import type { ReactNode } from 'react';
import { PageHeader } from '../PageHeader';
import styles from '../CapabilityCatalog.module.css';

/** 平台目录共用页头与分区间距，表格和编辑内容由各能力提供。 */
export function CatalogPage({ title, description, children }: { readonly title: string; readonly description?: string; readonly children: ReactNode }) {
  return <><PageHeader title={title} description={description} /><div className={styles.catalogSections}>{children}</div></>;
}
