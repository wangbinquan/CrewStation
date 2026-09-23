import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

const DialogHostContext = createContext<HTMLElement | null>(null);

/**
 * 弹窗的挂载点，放在应用根上：弹窗经 portal 渲染到这里，不再落在打开它的组件里面——
 * 那里可能在 `<form>` 里（表单不能嵌套）、在隐藏的面板里（`display: none` 里的弹窗画不出来），或在别的弹窗里。
 * 挂载点在渲染时就建好、排在内容之前：弹窗首次渲染就能 portal 进来，提交时挂载点先进文档，弹窗的 `showModal()` 才不会落空。
 * 挂载点只放进去、不在引用回调里移出：移出再放回会把打开着的弹窗踢出顶层（开发模式的 StrictMode 会这样重放引用）。
 * 没有挂载点时（单独渲染组件的用例）弹窗原地渲染。
 */
export function DialogHost({ children }: { readonly children: ReactNode }): ReactElement {
  const [host] = useState(() => (typeof document === 'undefined' ? null : document.createElement('div')));
  const attach = useCallback((slot: HTMLDivElement | null) => {
    if (slot && host && host.parentNode !== slot) slot.appendChild(host);
  }, [host]);
  return <DialogHostContext.Provider value={host}><div ref={attach} data-dialog-host="" />{children}</DialogHostContext.Provider>;
}

/** 当前应用的弹窗挂载点；不在 DialogHost 里时为 null。 */
export function useDialogHost(): HTMLElement | null {
  return useContext(DialogHostContext);
}
