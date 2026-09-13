import { createBrowserHistory } from '@tanstack/react-router';

/** 使用真正的浏览器历史适配器；只替代 DOM 的底层 History 存储与 popstate 调度。
 * createMemoryHistory 跳过 BACK／FORWARD／GO 的 blocker，不能验证返回键草稿保护。 */
export function browserHistoryFixture(initialEntries: string[]) {
  const entries = initialEntries.map((href, index) => ({ href, state: { __TSR_index: index, __TSR_key: `fixture-${index}` } as Record<string, unknown> }));
  let index = entries.length - 1;
  const surface = new EventTarget();
  const go = (delta: number) => {
    const next = Math.min(entries.length - 1, Math.max(0, index + delta));
    if (next === index) return;
    queueMicrotask(() => { index = next; surface.dispatchEvent(new PopStateEvent('popstate', { state: entries[index]!.state })); });
  };
  const nativeHistory = {
    get state() { return entries[index]!.state; }, get length() { return entries.length; },
    pushState(state: Record<string, unknown>, _unused: string, href: string) { entries.splice(index + 1); entries.push({ href, state }); index += 1; },
    replaceState(state: Record<string, unknown>, _unused: string, href?: string) { entries[index] = { href: href ?? entries[index]!.href, state }; },
    go, back: () => go(-1), forward: () => go(1),
  };
  Object.defineProperties(surface, {
    history: { value: nativeHistory },
    location: { get: () => new URL(entries[index]!.href, 'http://localhost') },
    document: { value: { baseURI: 'http://localhost/' } },
  });
  return { history: createBrowserHistory({ window: surface }), beforeUnload: () => {
    const event = new Event('beforeunload', { cancelable: true }); surface.dispatchEvent(event); return event.defaultPrevented;
  } };
}
