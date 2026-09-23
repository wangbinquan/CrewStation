import { createLink } from '@tanstack/react-router';
import type { ComponentPropsWithRef, ReactElement } from 'react';
import type { ButtonSize, ButtonVariant } from '../Button';
import { buttonClassName } from '../Button';
import styles from '../Button.module.css';

interface ButtonAnchorProps extends ComponentPropsWithRef<'a'> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

function ButtonAnchor({ variant, size, className, ...rest }: ButtonAnchorProps): ReactElement {
  // data-button：让「按钮」这一类的局部密度规则（如开发页的 `.workspace button`）同样作用到按钮样式链接上。
  return <a data-button="" className={buttonClassName(variant, size, className)} {...rest} />;
}

/**
 * 按钮样式的站内跳转（2026-09-23 裁定：动作型链接一律做成按钮样子）。仍是 `<a>`：
 * Cmd／Ctrl＋点击开新标签页、右键复制链接、读屏报为链接都照旧；`to`／`params`／`search` 与 `Link` 相同。
 * 名字、标签、地址这类引用型链接仍用文字链接。
 */
export const ButtonLink = createLink(ButtonAnchor);

/** 新窗口打开外部地址的按钮样式链接，末尾由样式带 ↗（不进文字、读屏不念），文案里不要再写。 */
export function ExternalButtonLink({ className, ...props }: Omit<ButtonAnchorProps, 'target' | 'rel'> & { readonly href: string }): ReactElement {
  return <ButtonAnchor target="_blank" rel="noreferrer" className={[styles.external, className].filter(Boolean).join(' ')} {...props} />;
}
