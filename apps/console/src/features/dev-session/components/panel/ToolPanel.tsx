import type { WorkspaceToolName } from '@crewstation/contracts';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { ToolPanelProvider } from '../../../../shared/project/ToolPanelContext';
import { Button } from '../../../../shared/ui/Button';
import { Tabs } from '../../../../shared/ui/Tabs';
import styles from './ToolPanel.module.css';

export interface ToolPane {
  readonly name: WorkspaceToolName;
  readonly content: ReactNode;
  /** 代码与数据面板带草稿，收起也保持挂载；预览与变更只在打开时渲染。 */
  readonly keepMounted?: boolean;
  /** 预览、代码与变更占满面板正文、顶端操作条定住、在自己内部滚动（RFC-003「独立预览占满工作内容区」）；其余是文档式内容：至少一屏高、最后一项长满，长了由面板正文滚动。 */
  readonly fill?: boolean;
  /** 页签后缀：未保存、待处理数。 */
  readonly suffix?: string;
  readonly disabled?: boolean;
}

export interface ToolPanelProps {
  readonly active?: WorkspaceToolName;
  readonly mode: 'side' | 'full' | 'closed';
  readonly panes: readonly ToolPane[];
  readonly onSelect: (name: WorkspaceToolName) => void;
  readonly onToggleMode: () => void;
  readonly onClose: () => void;
  /** 内容区窄于阈值时只能放大：隐藏还原按钮，说明原因。 */
  readonly forcedFull?: boolean;
}

/**
 * 终端旁的工具面板（RFC-020 D1）：一排页签，右侧放大／还原与收起。
 * 收起时缩成右缘一条竖排的页签栏，工具始终在手边；带草稿的面板仍挂在树上。面板自身不知道布局如何持久化。
 */
export function ToolPanel({ active, mode, panes, onSelect, onToggleMode, onClose, forcedFull = false }: ToolPanelProps): ReactElement {
  const t = useT();
  const label = (pane: ToolPane) => `${t(`devSession.native.view.${pane.name}`)}${pane.suffix ? ` · ${pane.suffix}` : ''}`;
  const current = active ?? panes[0]?.name ?? 'preview';
  const body = panes.map((pane) => {
    const visible = pane.name === current && mode !== 'closed';
    if (!visible && !pane.keepMounted) return null;
    return <div key={pane.name} className={`${styles.pane} ${pane.fill ? styles.fill : styles.flow}`} hidden={!visible}>{pane.disabled ? <p className={styles.note}>{t('devSession.panel.needsSession')}</p> : pane.content}</div>;
  });
  if (mode === 'closed') return <aside className={styles.rail} aria-label={t('devSession.panel.label')} data-mode="closed">
    {panes.map((pane) => <Button key={pane.name} variant="ghost" className={styles.railTab} disabled={pane.disabled} title={t('devSession.panel.open', { tool: label(pane) })} onClick={() => onSelect(pane.name)}>{label(pane)}</Button>)}
    <div hidden>{body}</div>
  </aside>;
  return <aside className={styles.panel} aria-label={t('devSession.panel.label')} data-mode={mode}>
    <ToolPanelProvider value={{ mode, maximize: () => { if (mode !== 'full') onToggleMode(); }, restore: () => { if (mode === 'full') onToggleMode(); } }}>
      <Tabs label={t('devSession.panel.label')} value={current} items={panes.map((pane) => ({ value: pane.name, label: label(pane) }))} onChange={(value) => { const pane = panes.find((item) => item.name === value); if (pane && !pane.disabled) onSelect(pane.name); }}
        extra={<>
          {forcedFull ? <span className={styles.note}>{t('devSession.panel.narrow')}</span> : <Button variant="ghost" className={styles.control} aria-pressed={mode === 'full'} title={t(mode === 'full' ? 'devSession.panel.restore' : 'devSession.panel.maximize')} onClick={onToggleMode}>{mode === 'full' ? t('devSession.panel.restore') : t('devSession.panel.maximize')}</Button>}
          <Button variant="ghost" className={styles.control} title={t('devSession.panel.close')} onClick={onClose}>{t('devSession.panel.close')}</Button>
        </>}>
        {body}
      </Tabs>
    </ToolPanelProvider>
  </aside>;
}
