import { useLayoutEffect } from 'react';
import type { RuntimeSearch } from '../model/runtimeSearch';
interface ScrollPosition { top: number; left: number }
interface ReturnPosition { main: number; window: number; taskId: string; dialog: boolean; ancestors: ScrollPosition[] }
const saved = new Map<string, ReturnPosition>();
export const runtimeReturnKey = (scope: string, s: RuntimeSearch) => JSON.stringify([scope, s.from, s.to, s.tab, s.q, s.state, s.agent, s.profile, s.quality, s.sourceKind]);
function taskButtons(taskId: string) {
  return [...document.querySelectorAll<HTMLElement>('[data-runtime-task-id]')]
    .filter(node => node.dataset.runtimeTaskId === taskId)
    .flatMap(node => { const button = node.querySelector<HTMLButtonElement>('button'); return button ? [button] : []; });
}
export function rememberRuntimeList(key: string, taskId: string) {
  if (saved.size >= 20) saved.delete(saved.keys().next().value!);
  const buttons = taskButtons(taskId), target = buttons.find(button => button === document.activeElement)
    ?? buttons.find(button => button.closest('dialog[open]')) ?? buttons[0];
  const ancestors: ScrollPosition[] = [];
  for (let node: HTMLElement | null = target ?? null; node; node = node.parentElement) ancestors.push({ top: node.scrollTop, left: node.scrollLeft });
  saved.set(key, { main: document.querySelector('main')?.scrollTop ?? 0, window: window.scrollY, taskId, dialog: !!target?.closest('dialog[open]'), ancestors });
}
export function useRuntimeListReturn(key: string, ready: boolean) {
  useLayoutEffect(() => {
    const position = saved.get(key); if (!ready || !position) return;
    let frame: number | undefined;
    const restore = () => {
      const target = taskButtons(position.taskId).find(button => !!button.closest('dialog[open]') === position.dialog);
      if (!target) return;
      let node: HTMLElement | null = target;
      for (const ancestor of position.ancestors) { if (!node) break; node.scrollTop = ancestor.top; node.scrollLeft = ancestor.left; node = node.parentElement; }
      const main = document.querySelector('main'); if (main) main.scrollTop = position.main;
      window.scrollTo(0, position.window); target.focus({ preventScroll: true }); saved.delete(key); observer.disconnect();
    };
    const observer = new MutationObserver(() => { if (frame !== undefined) cancelAnimationFrame(frame); frame = requestAnimationFrame(restore); });
    // Contribution dialogs live in the shared portal and may load after the main report.
    observer.observe(document.body, { childList: true, subtree: true }); frame = requestAnimationFrame(restore);
    return () => { observer.disconnect(); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [key, ready]);
}
