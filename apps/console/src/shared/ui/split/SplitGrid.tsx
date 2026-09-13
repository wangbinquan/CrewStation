import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { adjustSplit, splitWeights } from './splitGeometry';
import styles from './SplitGrid.module.css';

export interface SplitGridProps {
  readonly items: readonly { id: string; content: ReactNode }[];
  readonly mode: 'grid' | 'rows' | 'columns';
  readonly ratios: { columns: number[]; rows: number[] };
  readonly onResize: (ratios: { columns: number[]; rows: number[] }) => void;
  readonly separatorLabel: (axis: 'columns' | 'rows', index: number) => string;
}

/** 通用分屏：按可用宽度换行，最小尺寸优先，方向键与拖动调整同一份比例。 */
export function SplitGrid({ items, mode, ratios, onResize, separatorLabel }: SplitGridProps): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(entry.contentRect.width); });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const cols = Math.max(1, Math.min(items.length, mode === 'rows' ? 1 : mode === 'grid' ? 2 : items.length, Math.floor(width / 280)));
  const rows = Math.max(1, Math.ceil(items.length / cols));
  const columnWeights = splitWeights(ratios.columns, cols), rowWeights = splitWeights(ratios.rows, rows);
  const tracks = (weights: number[], minimum: number) => weights.map((weight) => `minmax(${minimum}px, ${weight}fr)`).join(' 6px ');
  const style: CSSProperties = { gridTemplateColumns: tracks(columnWeights, 0), gridTemplateRows: tracks(rowWeights, 172) };
  const separator = (axis: 'columns' | 'rows', weights: number[], index: number) => {
    const horizontal = axis === 'columns';
    return <div key={`${axis}-${index}`} role="separator" tabIndex={0} aria-label={separatorLabel(axis, index + 1)} aria-orientation={horizontal ? 'vertical' : 'horizontal'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(weights[index]! * 100)}
      className={horizontal ? styles.columnHandle : styles.rowHandle}
      style={horizontal ? { gridColumn: (index + 1) * 2, gridRow: items.length === 3 && cols === 2 ? '1' : '1 / -1' } : { gridRow: (index + 1) * 2, gridColumn: '1 / -1' }}
      onKeyDown={(event) => {
        const direction = event.key === (horizontal ? 'ArrowRight' : 'ArrowDown') ? 1 : event.key === (horizontal ? 'ArrowLeft' : 'ArrowUp') ? -1 : 0;
        if (!direction) return;
        event.preventDefault(); onResize({ ...ratios, [axis]: adjustSplit(weights, index, direction * 0.03, 0.1) });
      }}
      onPointerDown={(event) => {
        const handle = event.currentTarget, start = horizontal ? event.clientX : event.clientY;
        const rect = root.current!.getBoundingClientRect(), span = horizontal ? rect.width : rect.height;
        handle.setPointerCapture(event.pointerId);
        const move = (e: PointerEvent) => onResize({ ...ratios, [axis]: adjustSplit(weights, index, ((horizontal ? e.clientX : e.clientY) - start) / span, 0.1) });
        const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); };
        handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
      }} />;
  };
  return <div className={styles.grid} ref={root} style={style}>
    {items.map((item, index) => <div key={item.id} className={styles.pane} style={{ gridRow: Math.floor(index / cols) * 2 + 1, gridColumn: items.length === 3 && cols === 2 && index === 2 ? '1 / -1' : index % cols * 2 + 1 }}>{item.content}</div>)}
    {columnWeights.slice(1).map((_, i) => separator('columns', columnWeights, i))}
    {rowWeights.slice(1).map((_, i) => separator('rows', rowWeights, i))}
  </div>;
}
