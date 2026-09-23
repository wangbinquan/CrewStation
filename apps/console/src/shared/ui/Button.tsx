import { createContext, useContext } from 'react';
import type { ComponentPropsWithRef, ReactElement } from 'react';
import styles from './Button.module.css';

/**
 * 全站按钮规范（2026-09-23 作者裁定，见 RFC-003 design §6）：
 * - `primary`（蓝底）：每组（页头、卡片操作条、表单、确认）最多一个，排在一组最左。
 * - `secondary`（白底描边）：其余动作；表格行、时间线行里的动作也是描边按钮，不用无边框文字。
 * - `danger`（红字红框）：下线、移除、删除、归档、结束进程这类不可撤销动作的触发按钮；最终确认用 `dangerPrimary`（红底白字）。
 * - `ghost`（无边框）：只用于「取消」「收起」这类放弃当前操作的按钮。
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerPrimary';
/**
 * 两档高度：不传是标准 32px（页头、卡片、表单、空状态）；`small` 是紧凑 26px（表格行、列表行、时间线行、
 * 复制这类紧贴文字的小工具、开发页工具条）。同一行、同一张卡里不混用两档，页面也不再自己改按钮的高度、内边距与字号。
 */
export type ButtonSize = 'small';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

/**
 * 一片区域里按钮的缺省档位。开发页整片是工具条密度：外层包 `ButtonSizeContext.Provider value="small"`，里面的按钮与
 * 按钮样式链接不写 size 也是紧凑档——代替原来在页面样式里改写按钮的高度、内边距与字号（2026-09-23 裁定）。
 */
export const ButtonSizeContext = createContext<ButtonSize | undefined>(undefined);

/** 按钮与按钮样式链接（`ButtonLink`）共用同一套外观。 */
export function buttonClassName(variant: ButtonVariant = 'secondary', size?: ButtonSize, className?: string): string {
  return [styles.button, styles[variant], size ? styles[size] : undefined, className].filter(Boolean).join(' ');
}

export function Button({ variant = 'secondary', size, type = 'button', className, ...rest }: ButtonProps): ReactElement {
  const area = useContext(ButtonSizeContext);
  // data-button：页面样式据此区分动作按钮与页签、树节点这类原生按钮（后者可以有自己的密度，动作按钮的尺寸只在这里定）。
  return <button type={type} data-button="" className={buttonClassName(variant, size ?? area, className)} {...rest} />;
}
