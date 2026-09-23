import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** 终端是否处于活动状态：焦点在终端里、页面可见且窗口在前台。 */
function isActive(element: HTMLElement): boolean {
  return element.contains(document.activeElement) && document.visibilityState === 'visible' && document.hasFocus();
}

/**
 * 跟踪终端的活动状态（2026-09-23 裁定「焦点在终端才保持」）：变化时回调 `onChange`；
 * 由不活动变为活动（点进或 Tab 进终端、切回这个标签页或窗口）时再回调 `onEnter`，调用方据此自动取得输入。
 * 失焦时新焦点还没落定，所以延到下一拍再判断。卸载时按不活动收尾。
 */
export function useTerminalFocus(host: RefObject<HTMLElement | null>, onChange: (active: boolean) => void, onEnter: () => void): void {
  const callbacks = useRef({ onChange, onEnter });
  useEffect(() => { callbacks.current = { onChange, onEnter }; }, [onChange, onEnter]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let active = false, timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const next = isActive(element);
      if (next === active) return;
      active = next;
      callbacks.current.onChange(next);
      if (next) callbacks.current.onEnter();
    };
    const later = () => { if (timer) clearTimeout(timer); timer = setTimeout(update, 0); };
    element.addEventListener('focusin', update);
    element.addEventListener('focusout', later);
    window.addEventListener('focus', later);
    window.addEventListener('blur', later);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      if (timer) clearTimeout(timer);
      element.removeEventListener('focusin', update);
      element.removeEventListener('focusout', later);
      window.removeEventListener('focus', later);
      window.removeEventListener('blur', later);
      document.removeEventListener('visibilitychange', update);
      if (active) callbacks.current.onChange(false);
    };
  }, [host]);
}
