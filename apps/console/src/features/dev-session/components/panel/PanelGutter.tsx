import type { ReactElement, RefObject } from 'react';
import { MAX_RATIO, MIN_RATIO } from '../../hooks/layout/useToolPanel';
import styles from './ToolPanel.module.css';

/** 终端与面板之间的分隔线：拖动或方向键改面板占比（0.3–0.6）；只在「在旁」形态出现。 */
export function PanelGutter({ hidden, ratio, container, onResize, label }: { readonly hidden: boolean; readonly ratio: number; readonly container: RefObject<HTMLDivElement | null>; readonly onResize: (ratio: number) => void; readonly label: string }): ReactElement {
  return <div className={styles.gutter} hidden={hidden} role="separator" tabIndex={hidden ? -1 : 0} aria-orientation="vertical" aria-label={label} aria-valuemin={MIN_RATIO * 100} aria-valuemax={MAX_RATIO * 100} aria-valuenow={Math.round(ratio * 100)}
    onKeyDown={(event) => { const step = event.key === 'ArrowLeft' ? 0.03 : event.key === 'ArrowRight' ? -0.03 : 0; if (!step) return; event.preventDefault(); onResize(ratio + step); }}
    onPointerDown={(event) => {
      const handle = event.currentTarget, rect = container.current?.getBoundingClientRect(); if (!rect || rect.width === 0) return;
      handle.setPointerCapture(event.pointerId);
      const move = (e: PointerEvent) => onResize((rect.right - e.clientX) / rect.width);
      const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
    }} />;
}
