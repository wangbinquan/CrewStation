import { useId, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import { useDockDrag } from './DockLayout';
import styles from './DockLayout.module.css';

export interface DockTab {
  readonly id: string;
  readonly label: ReactNode;
  /** 跟手显示的名字与悬停提示。 */
  readonly name: string;
  readonly title?: string;
  /** 有它才显示 ×（读屏名称）。 */
  readonly closeLabel?: string;
  /** 正在改名等场合：不响应拖动与标签键。 */
  readonly editing?: boolean;
}
export interface DockTabsProps {
  readonly group: string;
  readonly label: string;
  readonly tabs: readonly DockTab[];
  readonly active?: string;
  /** 新开的 CLI 落在这一组：当前标签用主色标出。 */
  readonly focused: boolean;
  readonly draggable: boolean;
  readonly onActivate: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onDoubleClick: (id: string) => void;
  /** 右键或 Shift+F10／菜单键；位置是菜单左上角（视口坐标）。 */
  readonly onMenu: (id: string, at: { readonly x: number; readonly y: number }) => void;
  readonly onRename?: (id: string) => void;
  /** 标签面板的 id，供 aria-controls。 */
  readonly panelId?: string;
}

/**
 * 一组的标签栏：点选切换、按住拖动排列（交给 DockLayout）、双击、右键菜单、× 关闭；
 * 键盘上方向键／Home／End 切换，F2 改名，Shift+F10 或菜单键打开菜单。× 不进 Tab 顺序，键盘经菜单关闭。
 */
export function DockTabs({ group, label, tabs, active, focused, draggable, onActivate, onClose, onDoubleClick, onMenu, onRename, panelId }: DockTabsProps): ReactElement {
  const id = useId(), list = useRef<HTMLDivElement>(null), { controller, state } = useDockDrag();
  const index = Math.max(0, tabs.findIndex((tab) => tab.id === active));
  useLayoutEffect(() => { reveal(list.current); }, [active, tabs.length]);
  const marker = state.item && state.drop?.kind === 'tab' && state.drop.group === group ? state.drop.index : undefined;
  const keyDown = (event: KeyboardEvent<HTMLDivElement>, tab: DockTab, at: number) => {
    if (tab.editing || event.target !== event.currentTarget) return;
    if (event.key === 'F2' && onRename) { event.preventDefault(); onRename(tab.id); return; }
    if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
      event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); onMenu(tab.id, { x: rect.left, y: rect.bottom }); return;
    }
    const target = event.key === 'ArrowRight' ? (at + 1) % tabs.length : event.key === 'ArrowLeft' ? (at + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined;
    const next = target === undefined ? undefined : tabs[target];
    if (!next) return;
    event.preventDefault(); onActivate(next.id);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[target!]?.focus();
  };
  return <div className={styles.bar} data-dock-bar={group} data-focused={focused ? 'true' : 'false'}>
    <div ref={list} className={styles.tabs} role="tablist" aria-label={label}>
      {tabs.map((tab, at) => <div key={tab.id} id={`${id}-${at}`} role="tab" aria-selected={at === index} aria-controls={panelId} tabIndex={at === index ? 0 : -1}
        className={styles.tab} data-dock-tab={tab.id} data-marker={marker === at ? 'before' : marker === tabs.length && at === tabs.length - 1 ? 'after' : undefined} title={tab.title ?? tab.name}
        onPointerDown={(event) => {
          if (!draggable || tab.editing || (event.target as HTMLElement).closest('button, input')) return;
          controller?.press(event.currentTarget, event, { id: tab.id, group, label: tab.name });
        }}
        onClick={() => { if (!tab.editing) onActivate(tab.id); }}
        onDoubleClick={(event) => { if (!tab.editing && !(event.target as HTMLElement).closest('button')) onDoubleClick(tab.id); }}
        onContextMenu={(event) => { if (tab.editing) return; event.preventDefault(); onMenu(tab.id, { x: event.clientX, y: event.clientY }); }}
        onKeyDown={(event) => keyDown(event, tab, at)}>
        <span className={styles.tabLabel}>{tab.label}</span>
        {tab.closeLabel ? <button type="button" className={styles.close} tabIndex={-1} aria-label={tab.closeLabel} title={tab.closeLabel}
          onClick={(event) => { event.stopPropagation(); onClose(tab.id); }}>×</button> : null}
      </div>)}
    </div>
  </div>;
}

/** 当前标签滚进标签栏可视范围；只动标签栏自己的横向位置。 */
function reveal(list: HTMLElement | null): void {
  const tab = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  if (!list || !tab || list.clientWidth === 0) return;
  const left = list.getBoundingClientRect().left, right = left + list.clientWidth, item = tab.getBoundingClientRect();
  if (item.left < left) list.scrollLeft += item.left - left;
  else if (item.right > right) list.scrollLeft += item.right - right;
}
