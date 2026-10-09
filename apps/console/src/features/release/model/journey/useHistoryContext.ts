import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { readWizardStorage, saveWizardStorage } from './storage';

const ScrollSchema = z.array(z.number().nonnegative()).max(20);
/** Restore the exact list and its scroll ancestors after an independent detail route. */
export function useHistoryContext(key: string, focus: string | undefined, ready: boolean) {
  const ref = useRef<HTMLDivElement>(null), restored = useRef(false);
  const ancestors = () => {
    const result: HTMLElement[] = [];
    for (let node: HTMLElement | null = ref.current; node && result.length < 19; node = node.parentElement) result.push(node);
    return result;
  };
  useEffect(() => {
    if (!ready || !focus || restored.current) return;
    const target = document.getElementById(`release-history-${focus}`);
    if (!target) return;
    restored.current = true;
    target.focus({ preventScroll: true });
    const offsets = readWizardStorage(key, ScrollSchema);
    if (offsets) { ancestors().forEach((node, index) => { node.scrollTop = offsets[index] ?? 0; }); window.scrollTo(0, offsets.at(-1) ?? 0); }
  }, [focus, ready, key]);
  return { ref, remember: () => saveWizardStorage(key, [...ancestors().map(node => node.scrollTop), window.scrollY]) };
}
