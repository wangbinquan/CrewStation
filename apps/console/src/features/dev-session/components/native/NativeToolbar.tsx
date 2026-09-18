import type { AgentPermission, WorkspaceLayout } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { errorMessage, useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import type { WorkspaceLayoutStore } from '../../model/layout/workspaceLayoutStore';
import { closeWorkspaceTab, updateWorkspaceTab } from '../../model/layout/workspaceLayout';
import { AGENT_PERMISSIONS } from '../../model/agentOptions';
import { choiceBlocked, choicesFor, resolveChoice } from '../../model/computeChoices';
import { ComputeOptions, computeBlockText } from '../agents/ComputeOptions';
import type { useNativeTerminals } from '../../hooks/native/useNativeTerminals';
import styles from './NativeWorkspace.module.css';

export function NativeToolbar({ layout, store, native, canStart, onPreviewAlongside }: { readonly layout: WorkspaceLayout; readonly store: WorkspaceLayoutStore; readonly native: ReturnType<typeof useNativeTerminals>; readonly canStart: boolean; readonly onPreviewAlongside?: (show: boolean) => void }): ReactElement {
  const t = useT();
  const profiles = useApiQuery(queryKeys.computeProfiles(), () => api.catalog.listComputeProfiles());
  const compute = layout.preferredCompute ?? '';
  // 「＋ CLI」列出全部档位（含仅终端的通用终端协议，RFC-006 C6）；选中的档位不可用、平台没设默认档位时不许启动：
  // 服务端会拒绝，前端先把原因摆出来。
  const items = choicesFor(profiles.data?.items ?? [], 'cli');
  const block = profiles.data === undefined ? undefined : choiceBlocked(items, compute);
  const blockText = computeBlockText(t, block, resolveChoice(items, compute));
  const [permission, setPermission] = useState<AgentPermission>('edit');
  const [rename, setRename] = useState<string | null>(null);
  const tab = layout.tabs.find((tab) => tab.id === layout.activeTabId)!;
  const nameInvalid = rename !== null && (!rename.trim() || rename.trim().length > 40);
  return <div className={styles.toolbar}>
    <Button variant="primary" disabled={!canStart || native.start.isPending || profiles.isPending || profiles.isError || block !== undefined || tab.paneOrder.length >= 32} onClick={() => native.launch(compute, permission)}>{t(native.start.isPending ? 'devSession.agents.starting' : native.retryingOriginal ? 'devSession.native.retryStart' : 'devSession.native.add')}</Button>
    <label className={styles.inlineField}><span>{t('devSession.agents.compute')}</span><select aria-label={t('devSession.agents.compute')} value={compute} disabled={native.start.isPending || native.retryingOriginal} onChange={(event) => store.update((value) => ({ ...value, preferredCompute: event.target.value || undefined }))}><ComputeOptions items={items} /></select></label>
    <details className={styles.menu}><summary>{t('devSession.native.advanced')}</summary><div className={styles.menuBody}><label>{t('devSession.agents.permission')}<select value={permission} disabled={native.start.isPending || native.retryingOriginal} onChange={(event) => setPermission(event.target.value as AgentPermission)}>{AGENT_PERMISSIONS.map((p) => <option key={p} value={p}>{t(`devSession.agentPermission.${p}`)}</option>)}</select></label></div></details>
    <div className={styles.segment} role="group" aria-label={t('devSession.native.layoutGroup')}>
      {(['columns', 'rows', 'grid'] as const).map((mode) => <Button key={mode} variant="ghost" aria-pressed={tab.layout === mode} onClick={() => store.update((value) => updateWorkspaceTab(value, tab.id, (current) => ({ ...current, layout: mode })))}>{t(`devSession.native.layout.${mode}`)}</Button>)}
      <Button variant="ghost" onClick={() => store.update((value) => updateWorkspaceTab(value, tab.id, (current) => ({ ...current, ratios: { columns: [1, 1], rows: [1, 1] } })))}>{t('devSession.native.equal')}</Button>
      <Button variant="ghost" aria-pressed={layout.previewAlongside} onClick={() => onPreviewAlongside ? onPreviewAlongside(!layout.previewAlongside) : store.update((value) => ({ ...value, previewAlongside: !value.previewAlongside }))}>{t('devSession.native.previewAlongside')}</Button>
    </div>
    <details className={styles.menu}><summary>{t('devSession.native.tabOptions')}</summary><div className={styles.menuBody}>
      <Button variant="ghost" onClick={() => setRename(tab.name)}>{t('devSession.native.rename')}</Button>
      <Button variant="ghost" onClick={() => store.update((value) => closeWorkspaceTab(value, tab.id, t('devSession.native.defaultTab')))}>{t('devSession.native.closeTab')}</Button>
      <small>{t('devSession.native.closeHint')}</small>
    </div></details>
    {rename !== null ? <form className={styles.rename} onSubmit={(event) => { event.preventDefault(); if (!nameInvalid) { store.update((value) => updateWorkspaceTab(value, tab.id, (current) => ({ ...current, name: rename.trim() }))); setRename(null); } }}>
      <input aria-label={t('devSession.native.tabName')} value={rename} aria-invalid={nameInvalid} aria-describedby="tab-name-hint" onChange={(event) => setRename(event.target.value)} />
      <small id="tab-name-hint">{t('devSession.native.nameHint')}</small><Button type="submit">{t('devSession.native.saveName')}</Button><Button onClick={() => setRename(null)}>{t('devSession.release.cancel')}</Button>
    </form> : null}
    {profiles.error ? <p className={styles.error}>{errorMessage(profiles.error)}</p> : null}
    {blockText ? <p className={styles.error}>{blockText}</p> : null}
  </div>;
}
