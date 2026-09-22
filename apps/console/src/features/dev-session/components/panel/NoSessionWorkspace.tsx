import type { ReactElement, ReactNode } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { parseDevelopmentSearch } from '../../../../shared/project/developmentSearch';
import { PROJECT_PATHS } from '../../../../shared/project/projectPaths';
import { useProjectScope } from '../../../../shared/project/ProjectScope';
import { useT } from '../../../../shared/lib/useT';
import { locationTool, toolSearch } from '../../model/layout/developmentLocation';
import { ToolPanel } from './ToolPanel';
import styles from './ToolPanel.module.css';

/**
 * 没有开发会话时的工作区：主区是开会话表单，面板只有「参考」（RFC-020 design §5.4）。
 * 没有 taskId 就没有个人布局，形态只由地址表达；放大形态即原「开发资源」整页。
 */
export function NoSessionWorkspace({ form, reference }: { readonly form: ReactNode; readonly reference: ReactNode }): ReactElement {
  const t = useT(), { projectId, space } = useProjectScope(), navigate = useNavigate();
  const search = parseDevelopmentSearch(useSearch({ strict: false })), instruction = locationTool(search);
  const open = instruction?.name === 'reference' ? instruction : undefined;
  const go = (tool: { name: 'reference'; mode: 'side' | 'full' } | null) => void navigate({ to: PROJECT_PATHS[space].development, params: { projectId }, search: toolSearch(tool, { topic: search.topic, guide: search.guide, proxy: search.proxy, operation: search.operation, subscription: search.subscription }) });
  const mode = open ? open.mode : 'closed';
  const columns = mode === 'side' ? 'minmax(0, 0.55fr) 6px minmax(0, 0.45fr)' : mode === 'full' ? '0 0 minmax(0, 1fr)' : 'minmax(0, 1fr) 0 0';
  return <div className={styles.noSession} data-panel={mode} style={{ gridTemplateColumns: columns }}>
    <div className={styles.noSessionMain} hidden={mode === 'full'}>{form}{mode === 'closed' ? <p className={styles.note}><button type="button" className={styles.linkButton} onClick={() => go({ name: 'reference', mode: 'side' })}>{t('devSession.panel.openReference')}</button></p> : null}</div>
    <div className={styles.gutter} hidden={mode !== 'side'} aria-hidden="true" />
    <ToolPanel active="reference" mode={mode} panes={[{ name: 'reference', content: reference, keepMounted: true }]} onSelect={() => go({ name: 'reference', mode: mode === 'full' ? 'full' : 'side' })} onToggleMode={() => go({ name: 'reference', mode: mode === 'full' ? 'side' : 'full' })} onClose={() => go(null)} />
  </div>;
}
