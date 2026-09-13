import { useBlocker } from '@tanstack/react-router';
import type { ShouldBlockFn } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../lib/useT';
import { ConfirmationPanel } from '../ui/ConfirmationPanel';

interface NavigationLocation { readonly pathname: string; readonly search: object }
export interface UnsavedChangesGuardProps {
  readonly dirty: boolean;
  readonly scope: string;
  /** 允许不卸载草稿的页面内部导航，例如两个常驻配置环境间切换。 */
  readonly allowNavigate?: (current: NavigationLocation, next: NavigationLocation) => boolean;
}

/** 一次只确认一个导航；不使用会冻结页面的浏览器模态框，也不持久化草稿值。 */
export function UnsavedChangesGuard({ dirty, scope, allowNavigate }: UnsavedChangesGuardProps) {
  const t = useT(), resolver = useRef<((blocked: boolean) => void) | undefined>(undefined);
  const [pending, setPending] = useState(false), panel = useRef<HTMLDivElement>(null);
  const shouldBlockFn = useCallback<ShouldBlockFn>(({ current, next }) => {
    if (!dirty || allowNavigate?.(current, next)) return false;
    if (resolver.current) return true;
    return new Promise<boolean>((resolve) => { resolver.current = resolve; setPending(true); });
  }, [dirty, allowNavigate]);
  useBlocker({ shouldBlockFn, enableBeforeUnload: false });
  useEffect(() => () => { resolver.current?.(true); }, []);
  useEffect(() => { if (pending) panel.current?.querySelector<HTMLButtonElement>('button:last-child')?.focus(); }, [pending]);
  const finish = (blocked: boolean) => { const resolve = resolver.current; resolver.current = undefined; setPending(false); resolve?.(blocked); };
  if (!pending) return null;
  return <div ref={panel}><ConfirmationPanel question={t('ui.draft.question', { scope })} hint={t('ui.draft.hint')} confirmLabel={t('ui.draft.leave')} cancelLabel={t('ui.draft.stay')} onConfirm={() => finish(false)} onCancel={() => finish(true)} /></div>;
}
