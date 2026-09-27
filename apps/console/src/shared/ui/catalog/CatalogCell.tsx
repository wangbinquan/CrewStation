import type { ReactNode } from 'react';
import styles from '../CapabilityCatalog.module.css';

/** A visible mobile label supplements the retained semantic table header. */
export function CatalogCell({ label, children, className }: { readonly label?: string; readonly children: ReactNode; readonly className?: string }) {
  return <td className={className}>{label ? <span className={styles.cellLabel} aria-hidden="true">{label}</span> : null}{children}</td>;
}
