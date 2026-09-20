import { useId } from 'react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import styles from './ChoiceField.module.css';

interface ChoiceFieldProps extends Omit<ComponentPropsWithRef<'input'>, 'type' | 'children'> {
  readonly type?: 'checkbox' | 'radio';
  readonly label: ReactNode;
  readonly description?: ReactNode;
}

/** 原生选择控件保留键盘和读屏语义，整行标签扩大点击区域。 */
export function ChoiceField({ type = 'checkbox', label, description, ...input }: ChoiceFieldProps) {
  const id = useId();
  return <label className={styles.choice}>
    <input {...input} type={type} aria-describedby={description ? id : undefined} />
    <span className={styles.content}><span className={styles.label}>{label}</span>
      {description ? <span className={styles.description} id={id}>{description}</span> : null}
    </span>
  </label>;
}
