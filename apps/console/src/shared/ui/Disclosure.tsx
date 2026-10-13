import type {ReactNode} from 'react';
import styles from './Disclosure.module.css';
/** A native, initially collapsed information disclosure; the browser owns its open state. */
export function Disclosure({label,children,className}:{label:ReactNode;children:ReactNode;className?:string}) {
 return <details className={[styles.disclosure,className].filter(Boolean).join(' ')}><summary>{label}</summary><div className={styles.body}>{children}</div></details>;
}
