import { useLayoutEffect } from 'react';
import type { RuntimeSearch } from '../model/runtimeSearch';
const saved = new Map<string, { main: number; window: number; taskId: string }>();
export const runtimeReturnKey = (scope: string, s: RuntimeSearch) => JSON.stringify([scope, s.from, s.to, s.tab, s.q, s.state, s.agent, s.profile, s.quality]);
export function rememberRuntimeList(key: string, taskId: string) {
  if (saved.size >= 20) saved.delete(saved.keys().next().value!);
  saved.set(key, { main: document.querySelector('main')?.scrollTop ?? 0, window: window.scrollY, taskId });
}
export function useRuntimeListReturn(key: string, ready: boolean) {
  useLayoutEffect(() => {
    const position = saved.get(key); if (!ready || !position) return;
    const frame = requestAnimationFrame(() => {
      const main = document.querySelector('main'); if (main) main.scrollTop = position.main;
      window.scrollTo(0, position.window);
      if (!document.querySelector('dialog[open]')) [...document.querySelectorAll<HTMLElement>('[data-runtime-task-id]')].find((node) => node.dataset.runtimeTaskId === position.taskId)?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
      saved.delete(key);
    });
    return () => cancelAnimationFrame(frame);
  }, [key, ready]);
}
