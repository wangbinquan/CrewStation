import type { NativeTerminalDto, WorkspaceLayout } from '@crewstation/contracts';
import { newDraftResourceId } from '@crewstation/api-client';
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ActivityTask } from '../../../../shared/activity/agentActivityStore';
import type { Translate } from '../../../../shared/lib/useT';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { DockLayout } from '../../../../shared/ui/dock/DockLayout';
import type { ContextMenuItem } from '../../../../shared/ui/menu/ContextMenu';
import { ContextMenu } from '../../../../shared/ui/menu/ContextMenu';
import type { CliLauncher } from '../../hooks/native/useCliLauncher';
import { useMemberNames } from '../../hooks/native/useMemberNames';
import type { useNativeTerminals } from '../../hooks/native/useNativeTerminals';
import type { TaskStreamChannel } from '../../hooks/useTaskStream';
import type { WorkspaceLayoutStore } from '../../model/layout/workspaceLayoutStore';
import type { StreamState } from '../../model/taskStreamSocket';
import {
  acceptsDrop, activateTerminal, closeTerminal, dropTerminal, equalizeGroups, focusGroup, groupOf, isLiveTerminal, layoutDock, maximizedGroup, orderedTerminals,
  renameTerminal, resizeGroups, splitTerminal, toggleMaximize,
} from '../../model/layout/terminalGroups';
import { NativeTerminalCard } from './NativeTerminalCard';
import type { TerminalGroupActions } from './TerminalGroup';
import { TerminalGroup, terminalLabel } from './TerminalGroup';
import styles from './NativeWorkspace.module.css';

export interface CliDockProps {
  readonly projectId: string; readonly layout: WorkspaceLayout; readonly store: WorkspaceLayoutStore; readonly roster?: NativeTerminalDto[];
  readonly native: ReturnType<typeof useNativeTerminals>; readonly launcher: CliLauncher;
  readonly channel: TaskStreamChannel; readonly stream: StreamState; readonly activity?: ActivityTask;
  readonly canDevelop: boolean; readonly viewerId: string; readonly onActivity: () => void; readonly blockedReason?: string;
  /** 本页结束并关掉一个 CLI：名册还没跟上之前，对账不把它放回。 */
  readonly onDismiss: (terminalId: string) => void;
  readonly onRetry?: (terminal: NativeTerminalDto) => void;
  /** 环境未就绪时空白区的「查看连接详情」。 */
  readonly onDetails?: () => void;
}

/**
 * CLI 区（2026-09-23 裁定：Xshell 式标签组）：每个 CLI 一个标签，拖动标签排列与分屏，拖分隔线调大小（双击均分）；
 * 双击标签放大／还原这一组，右键（或 Shift+F10）有重命名、分屏与结束进程；× 结束进程并关闭标签。
 * 区域放不下整棵分屏树时只显示焦点组，标签栏列出全部 CLI。
 */
export function CliDock(props: CliDockProps): ReactElement {
  const { layout, store, roster, native, canDevelop } = props;
  const t = useT(), creatorName = useMemberNames(props.projectId);
  const [fits, setFits] = useState(true);
  const [menu, setMenu] = useState<{ readonly terminalId: string; readonly at: { readonly x: number; readonly y: number } } | null>(null);
  const [renaming, setRenaming] = useState<string>(), [closing, setClosing] = useState<string>();
  const find = (terminalId: string) => roster?.find((item) => item.terminalId === terminalId);
  const actions: TerminalGroupActions = {
    activate: (id) => store.update((value) => activateTerminal(value, id)),
    requestClose: (id) => {
      if (!isLiveTerminal(find(id))) { store.update((value) => closeTerminal(value, id)); return; }
      if (!canDevelop) return;
      store.update((value) => activateTerminal(value, id)); setClosing(id);
    },
    toggleMaximize: (id) => store.update((value) => toggleMaximize(value, id)),
    openMenu: (id, at) => setMenu({ terminalId: id, at }),
    startRename: setRenaming,
    commitRename: (id, name) => { store.update((value) => renameTerminal(value, id, name)); setRenaming(undefined); },
    cancelRename: () => setRenaming(undefined),
    confirmClose: (terminal) => native.stop.mutate(terminal.agentId, { onSuccess: () => { props.onDismiss(terminal.terminalId); store.update((value) => closeTerminal(value, terminal.terminalId)); setClosing(undefined); } }),
    cancelClose: () => setClosing(undefined),
    focusGroup: (groupId) => store.update((value) => focusGroup(value, groupId)),
  };
  if (layout.tabs.every((tab) => tab.paneOrder.length === 0)) return <EmptyCli launcher={props.launcher} blockedReason={props.blockedReason} onDetails={props.onDetails} />;
  const big = maximizedGroup(layout), merged = !fits && !big, everyone = orderedTerminals(layout);
  return <>
    <DockLayout root={layoutDock(layout)} solo={big?.id ?? (fits ? undefined : layout.activeTabId)} onFitChange={setFits}
      onResize={(path, sizes) => store.update((value) => resizeGroups(value, path, sizes))} onEqualize={(path) => store.update((value) => equalizeGroups(value, path))}
      accepts={(item, drop) => acceptsDrop(layout, item.id, drop)} onDrop={(item, drop) => store.update((value) => dropTerminal(value, item.id, drop, newDraftResourceId()))}
      separatorLabel={(direction) => t(`devSession.native.divider.${direction}`)}
      renderGroup={(groupId) => {
        const group = layout.tabs.find((tab) => tab.id === groupId);
        if (!group) return null;
        const active = group.activeTerminalId, terminal = active ? find(active) : undefined;
        return <TerminalGroup group={group} terminalIds={merged ? everyone : group.paneOrder} active={active} layout={layout} roster={roster} activity={props.activity} activitySync={native.query.data?.activitySync}
          viewerId={props.viewerId} creatorName={creatorName} focused={layout.activeTabId === groupId} draggable={!merged} canDevelop={canDevelop}
          closing={closing} stopping={native.stop.isPending} renaming={renaming} actions={actions}>
          {active ? <NativeTerminalCard key={active} terminalId={active} terminal={terminal} name={terminalLabel(layout, active, terminal)} activity={props.activity} activitySync={native.query.data?.activitySync}
            channel={props.channel} stream={props.stream} onTerminalChange={native.query.refetch} onRetry={props.onRetry} onActivity={props.onActivity} canDevelop={canDevelop} viewerId={props.viewerId} /> : null}
        </TerminalGroup>;
      }} />
    {menu ? <ContextMenu label={t('devSession.native.tabMenu', { name: terminalLabel(layout, menu.terminalId, find(menu.terminalId)) })} at={menu.at} onClose={() => setMenu(null)}
      items={menuItems({ layout, terminalId: menu.terminalId, terminal: find(menu.terminalId), merged, canDevelop, t, actions, onRetry: props.onRetry, split: (side) => { store.update((value) => splitTerminal(value, menu.terminalId, side, newDraftResourceId())); refocus(menu.terminalId); } })} /> : null}
  </>;
}

/** 用菜单分屏后标签挂到了新组里、旧元素已卸载：焦点跟到它身上，键盘用户可以接着操作。 */
function refocus(terminalId: string): void {
  setTimeout(() => document.querySelector<HTMLElement>(`[data-dock-tab="${terminalId}"]`)?.focus(), 0);
}

function menuItems({ layout, terminalId, terminal, merged, canDevelop, t, actions, onRetry, split }: {
  readonly layout: WorkspaceLayout; readonly terminalId: string; readonly terminal?: NativeTerminalDto; readonly merged: boolean; readonly canDevelop: boolean;
  readonly t: Translate; readonly actions: TerminalGroupActions; readonly onRetry?: (terminal: NativeTerminalDto) => void; readonly split: (side: 'left' | 'right' | 'top' | 'bottom') => void;
}): ContextMenuItem[] {
  const group = groupOf(layout, terminalId), live = isLiveTerminal(terminal), maximized = !!group && maximizedGroup(layout)?.id === group.id;
  const sides = (['left', 'right', 'top', 'bottom'] as const).map((side): ContextMenuItem => ({
    key: side, label: t(`devSession.native.split.${side}`), onSelect: () => split(side),
    disabled: merged || !group || !acceptsDrop(layout, terminalId, { kind: 'split', group: group.id, side }),
    hint: t(merged ? 'devSession.native.splitNarrow' : 'devSession.native.splitUnavailable'),
  }));
  return [
    { key: 'rename', label: t('devSession.native.rename'), shortcut: 'F2', onSelect: () => actions.startRename(terminalId) },
    { key: 'maximize', label: t(maximized ? 'devSession.native.restoreSize' : 'devSession.native.maximize'), disabled: !maximized && layout.tabs.length < 2, hint: t('devSession.native.maximizeSingle'), onSelect: () => actions.toggleMaximize(terminalId) },
    ...sides,
    ...(terminal?.lifecycle === 'failed' && onRetry ? [{ key: 'retry', label: t('devSession.native.retryExecution'), separated: true, onSelect: () => onRetry(terminal) }] : []),
    live ? { key: 'stop', label: t('devSession.native.stop'), danger: true, separated: true, disabled: !canDevelop, hint: t('devSession.connection.noPermission'), onSelect: () => actions.requestClose(terminalId) }
      : { key: 'close', label: t('devSession.native.close'), separated: true, onSelect: () => actions.requestClose(terminalId) },
  ];
}

/** 还没有 CLI：中间一个「＋ 创建开发Agent会话」；环境未就绪时写原因，可打开会话面板看连接详情。 */
function EmptyCli({ launcher, blockedReason, onDetails }: { readonly launcher: CliLauncher; readonly blockedReason?: string; readonly onDetails?: () => void }): ReactElement {
  const t = useT();
  return <div className={styles.empty}>
    <strong>{t(blockedReason ? 'devSession.native.notReady' : 'devSession.native.empty')}</strong>
    <p>{blockedReason ?? t('devSession.native.emptyHint')}</p>
    {blockedReason ? onDetails ? <Button onClick={onDetails}>{t('devSession.connection.details')}</Button> : null
      : <Button variant="primary" disabled={launcher.disabled} onClick={launcher.launch}>{launcher.label}</Button>}
  </div>;
}
