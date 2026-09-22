import type { AgentPermission, NativeTerminalDto, WorkspaceLayout } from '@crewstation/contracts';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { errorMessage, useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { SplitButton } from '../../../../shared/ui/menu/SplitButton';
import { useAgentActivity } from '../../../../shared/activity/AgentActivityProvider';
import { activityStatus } from '../../../../shared/activity/agentActivityView';
import type { WorkspaceLayoutStore } from '../../model/layout/workspaceLayoutStore';
import { closeWorkspaceTab, moveTerminal, updateWorkspaceTab } from '../../model/layout/workspaceLayout';
import { AGENT_PERMISSIONS } from '../../model/agentOptions';
import { choiceBlocked, choicesFor, resolveChoice } from '../../model/computeChoices';
import { ComputeOptions, computeBlockText } from '../agents/ComputeOptions';
import type { useNativeTerminals } from '../../hooks/native/useNativeTerminals';
import styles from './NativeWorkspace.module.css';

export interface NativeToolbarProps {
  readonly projectId: string; readonly taskId: string; readonly layout: WorkspaceLayout; readonly store: WorkspaceLayoutStore; readonly native: ReturnType<typeof useNativeTerminals>;
  readonly canStart: boolean; readonly blockedReason?: string; readonly isAdmin?: boolean; readonly roster?: NativeTerminalDto[];
}

/**
 * 工具行右半：「＋ 创建 CLI ▾」拆分按钮（主键按记住的档位与权限直接创建，展开换档位与权限）、「布局 ▾」、「⋯」（重命名、关闭工作区、已启动名册）。
 * 原来的三行控制合成一行（RFC-020 §4.3）；阻断原因仍在行下一行。
 */
export function NativeToolbar({ projectId, taskId, layout, store, native, canStart, blockedReason, isAdmin = false, roster }: NativeToolbarProps): ReactElement {
  const t = useT();
  const profiles = useApiQuery(queryKeys.computeProfiles(projectId), () => api.catalog.listComputeProfiles(projectId));
  const compute = layout.preferredCompute ?? '';
  // 「＋ CLI」列出全部档位（含仅终端的通用终端协议，RFC-006 C6）；选中的档位不可用、平台没设默认档位时不许启动：服务端会拒绝，前端先把原因摆出来。
  const items = choicesFor(profiles.data?.items ?? [], 'cli');
  const block = profiles.data === undefined ? undefined : choiceBlocked(items, compute);
  const blockText = computeBlockText(t, block, resolveChoice(items, compute));
  const [permission, setPermission] = useState<AgentPermission>('edit');
  const [rename, setRename] = useState<string | null>(null);
  const tab = layout.tabs.find((tab) => tab.id === layout.activeTabId)!;
  const nameInvalid = rename !== null && (!rename.trim() || rename.trim().length > 40);
  const starting = native.start.isPending || native.retryingOriginal;
  return <>
    <SplitButton label={t(native.start.isPending ? 'devSession.agents.starting' : native.retryingOriginal ? 'devSession.native.retryStart' : 'devSession.native.add')} menuLabel={t('devSession.native.startOptions')}
      disabled={!canStart || native.start.isPending || profiles.isPending || profiles.isError || block !== undefined || tab.paneOrder.length >= 32} onClick={() => native.launch(compute, permission)}
      menu={<>
        <label>{t('devSession.agents.compute')}<select aria-label={t('devSession.agents.compute')} value={compute} disabled={starting} onChange={(event) => store.update((value) => ({ ...value, preferredCompute: event.target.value || undefined }))}><ComputeOptions items={items} /></select></label>
        <label>{t('devSession.agents.permission')}<select aria-label={t('devSession.agents.permission')} value={permission} disabled={starting} onChange={(event) => setPermission(event.target.value as AgentPermission)}>{AGENT_PERMISSIONS.map((p) => <option key={p} value={p}>{t(`devSession.agentPermission.${p}`)}</option>)}</select></label>
        <small>{t('devSession.native.permissionHint')}</small>
      </>} />
    {tab.paneOrder.length > 0 ? <details className={styles.menu}><summary>{t('devSession.native.layoutMenu')}</summary><div className={styles.menuBody} role="group" aria-label={t('devSession.native.layoutGroup')}>
      {(['columns', 'rows', 'grid'] as const).map((mode) => <Button key={mode} variant="ghost" aria-pressed={tab.layout === mode} onClick={() => store.update((value) => updateWorkspaceTab(value, tab.id, (current) => ({ ...current, layout: mode })))}>{t(`devSession.native.layout.${mode}`)}</Button>)}
      <Button variant="ghost" onClick={() => store.update((value) => updateWorkspaceTab(value, tab.id, (current) => ({ ...current, ratios: { columns: [1, 1], rows: [1, 1] } })))}>{t('devSession.native.equal')}</Button>
    </div></details> : null}
    <details className={styles.menu}><summary title={t('devSession.native.tabOptions')} aria-label={t('devSession.native.tabOptions')}>⋯</summary><div className={styles.menuBody}>
      <Button variant="ghost" onClick={() => setRename(tab.name)}>{t('devSession.native.rename')}</Button>
      <Button variant="ghost" onClick={() => store.update((value) => closeWorkspaceTab(value, tab.id, t('devSession.native.defaultTab')))}>{t('devSession.native.closeTab')}</Button>
      <small>{t('devSession.native.closeHint')}</small>
      <RosterList taskId={taskId} roster={roster} store={store} />
    </div></details>
    {rename !== null ? <form className={styles.rename} onSubmit={(event) => { event.preventDefault(); if (!nameInvalid) { store.update((value) => updateWorkspaceTab(value, tab.id, (current) => ({ ...current, name: rename.trim() }))); setRename(null); } }}>
      <input aria-label={t('devSession.native.tabName')} value={rename} aria-invalid={nameInvalid} aria-describedby="tab-name-hint" onChange={(event) => setRename(event.target.value)} />
      <small id="tab-name-hint">{t('devSession.native.nameHint')}</small><Button type="submit">{t('devSession.native.saveName')}</Button><Button onClick={() => setRename(null)}>{t('devSession.release.cancel')}</Button>
    </form> : null}
    {blockedReason && tab.paneOrder.length > 0 ? <p className={styles.blockReason}>{blockedReason}</p> : null}
    {profiles.isPending ? <p className={styles.blockReason}>{t('devSession.native.loadingProfiles')}</p> : null}
    {tab.paneOrder.length >= 32 ? <p className={styles.blockReason}>{t('devSession.native.fullWorkspace')}</p> : null}
    {profiles.error ? <p className={styles.error}>{errorMessage(profiles.error)}</p> : null}
    {blockText ? <p className={styles.error}>{blockText}</p> : null}
    {profiles.error || blockText ? <div className={styles.helpActions}><Button disabled={profiles.isFetching} onClick={() => void profiles.refetch()}>{t('devSession.native.refreshProfiles')}</Button>{isAdmin ? <Link to="/admin/compute">{t('devSession.native.configureProfiles')}</Link> : <span>{t('devSession.native.askAdmin')}</span>}</div> : null}
  </>;
}

/** 已启动名册：布局里没有显示窗的 CLI 可放回当前工作区；只改显示，不动进程。 */
function RosterList({ taskId, roster, store }: { readonly taskId: string; readonly roster?: NativeTerminalDto[]; readonly store: WorkspaceLayoutStore }): ReactElement {
  const t = useT(), activity = useAgentActivity(), task = activity.snapshot.tasks.find((item) => item.taskId === taskId);
  return <div className={styles.roster}>
    <strong>{t('devSession.native.roster', { count: roster?.length ?? 0 })}</strong>
    {roster?.map((terminal) => <div key={terminal.terminalId}><code>CLI {terminal.agentId.slice(-6)}</code><span>{terminal.computeName ?? terminal.compute} · {t(`activity.status.${activityStatus(terminal, task?.page?.states.find((item) => item.terminalId === terminal.terminalId) ?? terminal.activity, task?.page, task?.stale)}`)}</span>
      <Button onClick={() => store.update((value) => moveTerminal(value, terminal.terminalId, value.activeTabId))}>{t('devSession.native.restore')}</Button></div>)}
    <small>{t('devSession.native.sharedHint')}</small>
  </div>;
}
