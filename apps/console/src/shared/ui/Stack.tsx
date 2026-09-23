import type { ComponentPropsWithRef, ReactElement } from 'react';
import styles from './Stack.module.css';

export interface StackProps extends ComponentPropsWithRef<'div'> {
  /** 在纵向弹性父级里长满剩余高度，最后一项也长满：工具面板里内容短时把最后一张卡拉到面板底边。 */
  readonly fill?: boolean;
}

/** 内容块之间的纵向间距；按钮保持自然宽度，表单、表格与提示仍占满可用宽度。 */
export function Stack({ className, fill = false, ...props }: StackProps): ReactElement {
  return <div className={[styles.stack, fill ? styles.fill : undefined, className].filter(Boolean).join(' ')} {...props} />;
}
