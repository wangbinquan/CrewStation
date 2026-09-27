import { useLayoutEffect, useRef } from 'react';

/** Query-based editor routes replace the list; restore its position after returning. */
export function useComputeListReturn(editing: boolean) {
  const saved = useRef<{ main: number; window: number; id?: string } | undefined>(undefined);
  useLayoutEffect(() => {
    if (editing || !saved.current) return;
    const position = saved.current;
    const frame = requestAnimationFrame(() => {
      const main = document.querySelector('main');
      if (main) main.scrollTop = position.main;
      window.scrollTo(0, position.window);
      const row = [...document.querySelectorAll<HTMLElement>('[data-profile-id]')].find((node) => node.dataset.profileId === position.id);
      row?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
      saved.current = undefined;
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);
  return (id?: string) => { if (!editing) saved.current = { main: document.querySelector('main')?.scrollTop ?? 0, window: window.scrollY, id }; };
}
