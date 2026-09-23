import type { NativeTerminalDto, WorkspaceLayout, WorkspaceTab } from '@crewstation/contracts';
import { useId, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { ActivityTask } from '../../../../shared/activity/agentActivityStore';
import { useT } from '../../../../shared/lib/useT';
import { ConfirmationPanel } from '../../../../shared/ui/ConfirmationPanel';
import { DockDropZone } from '../../../../shared/ui/dock/DockLayout';
import type { DockTab } from '../../../../shared/ui/dock/DockTabs';
import { DockTabs } from '../../../../shared/ui/dock/DockTabs';
import { customName, isLiveTerminal } from '../../model/layout/terminalGroups';
import { nativeTerminalStatus, statusTone } from '../../model/native/nativeTerminalStatus';
import styles from './TerminalGroup.module.css';

/** 标签上的名字：自己起的名字，否则默认名「CLI 」加 Agent ID 末六位。 */
export function terminalLabel(layout: WorkspaceLayout, terminalId: string, terminal: NativeTerminalDto | undefined): string {
  return customName(layout, terminalId) ?? defaultLabel(terminalId, terminal);
}
function defaultLabel(terminalId: string, terminal: NativeTerminalDto | undefined): string {
  return `CLI ${(terminal?.agentId ?? terminalId).slice(-6)}`;
}

export interface TerminalGroupActions {
  readonly activate: (terminalId: string) => void;
  readonly requestClose: (terminalId: string) => void;
  readonly toggleMaximize: (terminalId: string) => void;
  readonly openMenu: (terminalId: string, at: { readonly x: number; readonly y: number }) => void;
  readonly startRename: (terminalId: string) => void;
  readonly commitRename: (terminalId: string, name: string) => void;
  readonly cancelRename: () => void;
  readonly confirmClose: (terminal: NativeTerminalDto) => void;
  readonly cancelClose: () => void;
  readonly focusGroup: (groupId: string) => void;
}
export interface TerminalGroupProps {
  readonly group: WorkspaceTab;
  /** 这条标签栏列出的 CLI：通常是本组的；窄屏合并成一条时是全部。 */
  readonly terminalIds: readonly string[];
  readonly active?: string;
  readonly layout: WorkspaceLayout;
  readonly roster?: readonly NativeTerminalDto[];
  readonly activity?: ActivityTask;
  readonly activitySync?: 'ready' | 'catching-up' | 'unavailable';
  readonly viewerId: string;
  readonly creatorName: (userId: string) => string;
  readonly focused: boolean;
  readonly draggable: boolean;
  readonly canDevelop: boolean;
  /** 正在确认结束的 CLI（本组里的才在本组显示确认）。 */
  readonly closing?: string;
  readonly stopping: boolean;
  readonly renaming?: string;
  readonly actions: TerminalGroupActions;
  /** 当前标签的终端。 */
  readonly children: ReactNode;
}

/**
 * 一组 CLI 标签（Xshell 式）：标签栏上圆点是轮次状态、别人开的写上是谁；× 在运行的先确认再结束进程、已结束的直接关掉；
 * 画面里一次只显示当前标签。拖动、双击放大、右键菜单由 DockTabs／DockLayout 处理，动作交回 NativeWorkspace。
 */
export function TerminalGroup(props: TerminalGroupProps): ReactElement {
  const t = useT(), panelId = useId();
  const { group, terminalIds, layout, roster, activity, activitySync, viewerId, creatorName, canDevelop, closing, renaming, actions } = props;
  const tabs = terminalIds.map((terminalId): DockTab => {
    const terminal = roster?.find((item) => item.terminalId === terminalId), name = terminalLabel(layout, terminalId, terminal);
    const status = nativeTerminalStatus(terminal, terminalId, activity, activitySync, false), statusText = t(`activity.status.${status}`);
    const creator = terminal && terminal.createdBy !== viewerId ? creatorName(terminal.createdBy) : undefined;
    const live = isLiveTerminal(terminal), editing = renaming === terminalId;
    return {
      id: terminalId, name, editing,
      title: `${name}${creator ? ` · ${t('devSession.native.openedBy', { name: creator })}` : ''} · ${statusText}\n${t('devSession.native.tabHint')}`,
      closeLabel: live ? canDevelop ? t('devSession.native.stopTab', { name }) : undefined : t('devSession.native.closeTab', { name }),
      label: <>
        <span className={styles.dot} data-tone={statusTone(status)} aria-hidden="true" />
        {editing ? <RenameInput initial={name} onCommit={(value) => actions.commitRename(terminalId, value.trim() === defaultLabel(terminalId, terminal) ? '' : value)} onCancel={actions.cancelRename} /> : <span className={styles.name}>{name}</span>}
        {creator ? <span className={styles.creator}>{creator}</span> : null}
        <span className={styles.hidden}>{statusText}</span>
      </>,
    };
  });
  const closingTerminal = closing && terminalIds.includes(closing) ? roster?.find((item) => item.terminalId === closing) : undefined;
  const closingName = closingTerminal ? terminalLabel(layout, closingTerminal.terminalId, closingTerminal) : '';
  const activeName = tabs.find((tab) => tab.id === props.active)?.name;
  return <>
    <DockTabs group={group.id} label={t('devSession.native.tabs')} tabs={tabs} active={props.active} focused={props.focused} draggable={props.draggable} panelId={panelId}
      onActivate={actions.activate} onClose={actions.requestClose} onDoubleClick={actions.toggleMaximize} onMenu={actions.openMenu} onRename={actions.startRename} />
    <div className={styles.body} data-dock-body={group.id} id={panelId} role="tabpanel" aria-label={activeName}
      onFocusCapture={() => actions.focusGroup(group.id)} onPointerDownCapture={() => actions.focusGroup(group.id)}>
      {closingTerminal ? <ConfirmationPanel question={t('devSession.native.stopQuestion', { id: closingName })} busy={props.stopping}
        hint={closingTerminal.createdBy !== viewerId ? t('devSession.native.stopOtherHint', { name: creatorName(closingTerminal.createdBy) }) : t('devSession.native.stopHint')}
        confirmLabel={t('devSession.native.stop')} cancelLabel={t('devSession.release.cancel')} onConfirm={() => actions.confirmClose(closingTerminal)} onCancel={actions.cancelClose} /> : null}
      {props.children}
      <DockDropZone group={group.id} />
    </div>
  </>;
}

/** 标签里原地改名：回车保存、Escape 放弃、失焦按当前内容保存；清空即恢复默认名。只改自己看到的名字。 */
function RenameInput({ initial, onCommit, onCancel }: { readonly initial: string; readonly onCommit: (name: string) => void; readonly onCancel: () => void }): ReactElement {
  const t = useT(), [value, setValue] = useState(initial), done = useRef(false), invalid = value.trim().length > 40;
  // 提交时读输入框里的实际内容：输入法组字等场合 onChange 可能还没落到状态里。
  const finish = (commit: boolean, current: string) => {
    if (done.current) return;
    done.current = true;
    if (commit && current.trim().length <= 40) onCommit(current); else onCancel();
  };
  return <input className={styles.rename} aria-label={t('devSession.native.tabName')} title={t('devSession.native.nameHint')} value={value} aria-invalid={invalid} autoFocus
    size={Math.max(8, Math.min(24, value.length + 2))} onChange={(event) => setValue(event.target.value)} onBlur={(event) => finish(true, event.currentTarget.value)}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Enter' && event.currentTarget.value.trim().length <= 40) { event.preventDefault(); finish(true, event.currentTarget.value); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false, event.currentTarget.value); }
    }} />;
}
