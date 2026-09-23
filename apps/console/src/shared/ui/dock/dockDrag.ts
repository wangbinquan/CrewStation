import type { DockDrop, DockGeometry, DockRect, DropOptions } from './dockDrop';
import { resolveDrop, sameDrop } from './dockDrop';

export interface DockDragItem { readonly id: string; readonly group: string; readonly label: string }
export interface DockDragState { readonly item?: DockDragItem; readonly x: number; readonly y: number; readonly drop?: DockDrop }
export interface DockDragOptions extends DropOptions {
  readonly geometry: () => DockGeometry;
  /** 放下去会不会改变什么；不会的目标既不显示也不触发。 */
  readonly accepts: (item: DockDragItem, drop: DockDrop) => boolean;
  readonly onDrop: (item: DockDragItem, drop: DockDrop) => void;
}

/** 按下后移动超过这个距离才算拖动，更短的是点击。 */
export const DRAG_THRESHOLD = 4;
const IDLE: DockDragState = { x: 0, y: 0 };

/**
 * 标签拖动：按下时把指针捕获到这个标签上（经过终端、预览 iframe 也收得到移动），超过阈值才开始；
 * 松开时有目标就放下，Escape 或指针取消即放弃。拖过之后的那次 click 被吞掉，不会顺手激活标签。
 * 状态供标签栏画插入线、各组画落点区、外层画跟手的标签名。
 */
export class DockDragController {
  private state: DockDragState = IDLE;
  private readonly listeners = new Set<() => void>();
  private geometry?: DockGeometry;
  private release?: () => void;
  constructor(private options: DockDragOptions) {}
  setOptions(options: DockDragOptions): void { this.options = options; }
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  readonly getState = (): DockDragState => this.state;

  press(element: HTMLElement, event: { readonly pointerId: number; readonly clientX: number; readonly clientY: number; readonly button: number }, item: DockDragItem): void {
    if (event.button !== 0) return;
    this.cancel();
    const startX = event.clientX, startY = event.clientY;
    let dragging = false;
    try { element.setPointerCapture(event.pointerId); } catch { /* 没有活动指针（合成事件）时照常用元素上的监听 */ }
    const move = (e: PointerEvent) => {
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
      if (!dragging) { dragging = true; this.geometry = this.options.geometry(); document.body.dataset.dockDragging = 'true'; }
      this.update(item, e.clientX, e.clientY);
    };
    const finish = (commit: boolean) => {
      const { item: current, drop } = this.state;
      this.cancel();
      if (dragging) {
        // 松开后同一任务里紧跟的 click 不能再激活标签；下一拍就撤掉，免得吞掉之后真正的点击。
        element.addEventListener('click', swallow, { capture: true });
        setTimeout(() => element.removeEventListener('click', swallow, { capture: true }), 0);
      }
      if (commit && current && drop) this.options.onDrop(current, drop);
    };
    const up = () => finish(true), abort = () => finish(false);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && dragging) { e.preventDefault(); e.stopPropagation(); abort(); } };
    element.addEventListener('pointermove', move); element.addEventListener('pointerup', up); element.addEventListener('pointercancel', abort);
    window.addEventListener('keydown', key, true);
    this.release = () => {
      element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', up); element.removeEventListener('pointercancel', abort);
      window.removeEventListener('keydown', key, true);
      try { element.releasePointerCapture(event.pointerId); } catch { /* 已释放 */ }
      delete document.body.dataset.dockDragging;
    };
  }

  cancel(): void {
    this.release?.(); this.release = undefined; this.geometry = undefined;
    if (this.state !== IDLE) this.set(IDLE);
  }

  private update(item: DockDragItem, x: number, y: number): void {
    const found = this.geometry ? resolveDrop(x, y, this.geometry, this.options) : undefined;
    const drop = found && this.options.accepts(item, found) ? found : undefined;
    if (this.state.item === item && this.state.x === x && this.state.y === y && sameDrop(this.state.drop, drop)) return;
    this.set({ item, x, y, drop });
  }

  private set(state: DockDragState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

function swallow(event: Event): void {
  event.stopPropagation(); event.preventDefault();
}

const rectOf = (element: Element): DockRect => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; };

/** 在拖动开始时量一次：`data-dock-group` 的组里找 `data-dock-bar` 标签栏、`data-dock-tab` 标签与 `data-dock-body` 画面。 */
export function measureDock(root: HTMLElement | null): DockGeometry {
  if (!root) return { groups: [] };
  return {
    groups: [...root.querySelectorAll<HTMLElement>('[data-dock-group]')].filter((group) => !group.hidden).map((group) => {
      const bar = group.querySelector('[data-dock-bar]'), body = group.querySelector('[data-dock-body]') ?? group;
      return {
        id: group.dataset.dockGroup ?? '', body: rectOf(body), bar: bar ? rectOf(bar) : undefined,
        tabs: bar ? [...bar.querySelectorAll<HTMLElement>('[data-dock-tab]')].map((tab) => ({ id: tab.dataset.dockTab ?? '', rect: rectOf(tab) })) : [],
      };
    }),
  };
}
