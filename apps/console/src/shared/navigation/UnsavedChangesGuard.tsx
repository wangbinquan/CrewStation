import { useBlocker } from '@tanstack/react-router';
import type { ShouldBlockFn } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../lib/useT';
import { ConfirmationDialog } from '../ui/dialog/ConfirmationDialog';

export interface NavigationLocation { readonly pathname: string; readonly search: object }
export interface UnsavedChangesGuardProps {
  readonly dirty: boolean;
  readonly scope: string;
  /** 允许不卸载草稿的页面内部导航，例如两个常驻配置环境间切换。 */
  readonly allowNavigate?: (current: NavigationLocation, next: NavigationLocation) => boolean;
  readonly confirmationForNavigation?: (next: NavigationLocation) => { question: string; confirmLabel: string } | undefined;
  readonly isNavigationBusy?: (next: NavigationLocation) => boolean;
  /** 仅在用户确认放弃后调用；可用于同页文件切换，普通页面离开仍靠卸载处理。 */
  readonly onDiscard?: (next: NavigationLocation) => void;
}

/**
 * 一次只确认一个导航：以页面内的确认弹窗提示（2026-09-23 起；表单都在弹窗里，页内的提示会被表单弹窗挡住），默认聚焦「继续编辑」。
 * 页面被身份守卫藏起时也显示（persistent）：导航正等着这个回答。
 * 不使用会冻结页面的浏览器模态框，也不持久化草稿值。
 */
export function UnsavedChangesGuard({ dirty, scope, allowNavigate, confirmationForNavigation, isNavigationBusy, onDiscard }: UnsavedChangesGuardProps) {
  const t = useT(), resolver = useRef<((blocked: boolean) => void) | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const target = useRef<NavigationLocation | undefined>(undefined), [confirmation, setConfirmation] = useState<{ question: string; confirmLabel: string; next: NavigationLocation } | undefined>(undefined);
  const shouldBlockFn = useCallback<ShouldBlockFn>(({ current, next }) => {
    if (!dirty || allowNavigate?.(current, next)) return false;
    if (resolver.current) return true;
    return new Promise<boolean>((resolve) => { resolver.current = resolve; target.current = next;
      setConfirmation({ ...(confirmationForNavigation?.(next) ?? { question: t('ui.draft.question', { scope }), confirmLabel: t('ui.draft.leave') }), next }); setPending(true); });
  }, [dirty, allowNavigate, scope, confirmationForNavigation, t]);
  useBlocker({ shouldBlockFn, enableBeforeUnload: false });
  useEffect(() => () => { resolver.current?.(true); }, []);
  const finish = (blocked: boolean) => { const resolve = resolver.current, next = target.current; resolver.current = undefined; target.current = undefined;
    if (!blocked && next) onDiscard?.(next); setPending(false); resolve?.(blocked); };
  if (!pending) return null;
  return <ConfirmationDialog question={confirmation!.question} hint={t('ui.draft.hint')} confirmLabel={confirmation!.confirmLabel} cancelLabel={t('ui.draft.stay')} confirmDisabled={isNavigationBusy?.(confirmation!.next)} focus="cancel" persistent onConfirm={() => finish(false)} onCancel={() => finish(true)} />;
}
