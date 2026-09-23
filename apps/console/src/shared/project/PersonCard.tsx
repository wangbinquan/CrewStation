import type { ReactElement, ReactNode } from 'react';
import styles from './PersonCard.module.css';

/** 一个已注册账号：名字一行、邮箱一行，针对它的动作（选择、更换）靠右。账号查找的结果与成员弹窗里已选中的人共用。 */
export function PersonCard({ name, email, action }: { readonly name: string; readonly email: string; readonly action?: ReactNode }): ReactElement {
  return <div className={styles.card}>
    <span className={styles.identity}><span className={styles.name}>{name}</span><span className={styles.email}>{email}</span></span>
    {action !== undefined ? <span className={styles.action}>{action}</span> : null}
  </div>;
}
