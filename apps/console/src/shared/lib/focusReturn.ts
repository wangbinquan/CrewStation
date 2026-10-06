/**
 * 打开弹窗或确认面板的控件，以及关闭后把焦点还给它。
 * 打开它的按钮常在异步预检期间被禁用而失去焦点，此时 document.activeElement 已是 body，所以另记最近一次获得焦点的控件。
 */
/** 原生可聚焦控件也包括拓扑中的 SVG 节点。 */
export type FocusTarget = HTMLElement | SVGElement;
const isFocusTarget = (target: EventTarget | null): target is FocusTarget => target instanceof HTMLElement || target instanceof SVGElement;
let lastFocused: FocusTarget | null = null;
if (typeof document !== 'undefined') {
  const remember = (event: Event) => { if (isFocusTarget(event.target)) lastFocused = event.target; };
  document.addEventListener('focusin', remember, true);
  document.addEventListener('focus', remember, true);
}

/** 现在持有焦点的控件；焦点已落到 body 时退回最近一次获得焦点的控件。 */
export function currentOpener(): FocusTarget | null {
  const active = typeof document === 'undefined' ? null : document.activeElement;
  return isFocusTarget(active) && active !== document.body ? active : lastFocused;
}

/** 焦点回到打开者；它还在页面上才回。关闭的同一次提交里它可能仍带着 disabled，下一个宏任务再试一次。 */
export function returnFocus(target: FocusTarget | null): void {
  if (!target?.isConnected) return;
  target.focus();
  // Removing a nested modal later in the same commit can blur a successful immediate return.
  setTimeout(() => { if (target.isConnected && (document.activeElement === document.body || document.activeElement === null)) target.focus(); }, 0);
}
