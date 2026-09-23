import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactElement, ReactNode, RefObject } from 'react';
import type { DockDrop } from './dockDrop';
import type { DockDragItem, DockDragState } from './dockDrag';
import { DockDragController, measureDock } from './dockDrag';
import type { DockDivider as Divider } from './dockPlacement';
import { FULL_BOX, boxPixels, boxStyle, placeDock } from './dockPlacement';
import type { DockDirection, DockNode, DockPath } from './dockTree';
import { adjustSplit, dockGroups, minimumSize } from './dockTree';
import styles from './DockLayout.module.css';

/** 两组之间分隔条的宽度（像素）。 */
export const DOCK_GUTTER = 6;
/** 一组小于这个尺寸就不再分屏：放不下整棵树时调用方改为只显示一组。 */
export const DOCK_MIN_GROUP = { width: 260, height: 160 } as const;

const DragContext = createContext<DockDragController | undefined>(undefined);
const UNMOUNTED = { geometry: () => ({ groups: [] }), accepts: () => false, onDrop: () => {}, minWidth: DOCK_MIN_GROUP.width, minHeight: DOCK_MIN_GROUP.height };
const IDLE: DockDragState = { x: 0, y: 0 };
const noop = () => () => {};

/** 标签栏与落点区读当前拖动；不在 DockLayout 里时恒为空闲。 */
export function useDockDrag(): { readonly controller?: DockDragController; readonly state: DockDragState } {
  const controller = useContext(DragContext);
  const state = useSyncExternalStore(controller?.subscribe ?? noop, controller?.getState ?? (() => IDLE));
  return { controller, state };
}

export interface DockLayoutProps {
  readonly root: DockNode;
  readonly renderGroup: (group: string) => ReactNode;
  /** 只显示这一组并占满（放大，或放不下整棵树时）。 */
  readonly solo?: string;
  readonly onResize: (path: DockPath, sizes: number[]) => void;
  readonly onEqualize: (path: DockPath) => void;
  readonly accepts: (item: DockDragItem, drop: DockDrop) => boolean;
  readonly onDrop: (item: DockDragItem, drop: DockDrop) => void;
  readonly separatorLabel: (direction: DockDirection) => string;
  /** 区域放不放得下整棵树（每组不小于 DOCK_MIN_GROUP）；变化时回调。 */
  readonly onFitChange?: (fits: boolean) => void;
}

/**
 * 标签组分屏（Xshell 式）：每组是同一容器下按树绝对定位的兄弟，组间是可拖的分隔条（方向键微调、双击均分）；
 * 拖标签由组内的 `DockTabs` 发起，落点与跟手标签名由这里统一处理。
 */
export function DockLayout({ root, renderGroup, solo, onResize, onEqualize, accepts, onDrop, separatorLabel, onFitChange }: DockLayoutProps): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const [controller] = useState(() => new DockDragController(UNMOUNTED));
  // 挂载后才量得到几何；放下时用最新的判定与回调：每次提交后换上。
  useEffect(() => { controller.setOptions({ geometry: () => measureDock(host.current), accepts, onDrop, minWidth: DOCK_MIN_GROUP.width, minHeight: DOCK_MIN_GROUP.height }); });
  useEffect(() => () => controller.cancel(), [controller]);
  const placement = useMemo(() => solo ? { groups: [{ id: solo, box: FULL_BOX }], dividers: [] } : placeDock(root, DOCK_GUTTER), [root, solo]);
  const minimum = useMemo(() => minimumSize(root, DOCK_MIN_GROUP, DOCK_GUTTER), [root]);
  useFit(host, minimum, onFitChange);
  // DOM 顺序按组 ID 固定：重新排列只改位置，不挪动节点。
  const order = useMemo(() => [...new Set([...dockGroups(root), ...(solo ? [solo] : [])])].sort(), [root, solo]);
  return <DragContext.Provider value={controller}>
    <div ref={host} className={styles.dock}>
      {order.map((id) => {
        const placed = placement.groups.find((group) => group.id === id);
        return placed ? <div key={id} className={styles.group} data-dock-group={id} style={boxStyle(placed.box)}>{renderGroup(id)}</div> : null;
      })}
      {placement.dividers.map((divider) => <DockDivider key={divider.key} divider={divider} host={host} onResize={onResize} onEqualize={onEqualize} label={separatorLabel(divider.direction)} />)}
      <DragGhost />
    </div>
  </DragContext.Provider>;
}

function useFit(host: RefObject<HTMLDivElement | null>, minimum: { width: number; height: number }, onFitChange?: (fits: boolean) => void): void {
  const last = useRef<boolean | undefined>(undefined), callback = useRef(onFitChange);
  useEffect(() => { callback.current = onFitChange; }, [onFitChange]);
  useEffect(() => {
    const element = host.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const check = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const fits = width >= minimum.width && height >= minimum.height;
      if (fits !== last.current) { last.current = fits; callback.current?.(fits); }
    };
    const observer = new ResizeObserver(([entry]) => { if (entry) check(entry.contentRect.width, entry.contentRect.height); });
    observer.observe(element);
    check(element.clientWidth, element.clientHeight);
    return () => observer.disconnect();
  }, [host, minimum.width, minimum.height]);
}

function DockDivider({ divider, host, onResize, onEqualize, label }: { readonly divider: Divider; readonly host: RefObject<HTMLDivElement | null>; readonly onResize: (path: DockPath, sizes: number[]) => void; readonly onEqualize: (path: DockPath) => void; readonly label: string }): ReactElement {
  const row = divider.direction === 'row', total = divider.sizes.reduce((sum, value) => sum + value, 0) || 1;
  const weights = divider.sizes.map((value) => value / total);
  const span = () => { const rect = host.current?.getBoundingClientRect(); const pixels = boxPixels(divider.span, rect?.width ?? 0, rect?.height ?? 0); return row ? pixels.width : pixels.height; };
  return <div role="separator" tabIndex={0} aria-label={label} aria-orientation={row ? 'vertical' : 'horizontal'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((weights[divider.index] ?? 0) * 100)}
    className={row ? styles.columnHandle : styles.rowHandle} style={boxStyle(divider.box)}
    onDoubleClick={() => onEqualize(divider.path)}
    onKeyDown={(event) => {
      const direction = event.key === (row ? 'ArrowRight' : 'ArrowDown') ? 1 : event.key === (row ? 'ArrowLeft' : 'ArrowUp') ? -1 : 0;
      if (!direction) return;
      event.preventDefault(); onResize(divider.path, adjustSplit(weights, divider.index, direction * 0.03, 0.1));
    }}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      const handle = event.currentTarget, start = row ? event.clientX : event.clientY, length = span();
      if (length <= 0) return;
      try { handle.setPointerCapture(event.pointerId); } catch { /* 合成事件 */ }
      const move = (e: PointerEvent) => onResize(divider.path, adjustSplit(weights, divider.index, ((row ? e.clientX : e.clientY) - start) / length, 0.1));
      const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
    }} />;
}

function DragGhost(): ReactElement | null {
  const { state } = useDockDrag();
  if (!state.item) return null;
  return <div className={styles.ghost} style={{ left: state.x + 12, top: state.y + 12 }} aria-hidden="true" data-dropping={state.drop ? 'true' : 'false'}>{state.item.label}</div>;
}

/** 组的画面里放一个：拖动经过这组时按落点标出「分到哪一边」或「并入这一组」。 */
export function DockDropZone({ group }: { readonly group: string }): ReactElement | null {
  const { state } = useDockDrag(), drop = state.drop;
  if (!state.item || !drop || drop.kind === 'tab' || drop.group !== group) return null;
  return <div className={styles.zone} data-zone={drop.kind === 'split' ? drop.side : 'center'} aria-hidden="true" />;
}
