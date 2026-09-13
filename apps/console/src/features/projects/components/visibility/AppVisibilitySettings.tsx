import type { AppPresentationDto, AppVisibilityDto } from '@crewstation/contracts';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Card } from '../../../../shared/ui/Card';
import { ConfirmationPanel } from '../../../../shared/ui/ConfirmationPanel';
import { usePresentationEditor } from '../../model/usePresentationEditor';
import { useVisibilityEditor } from '../../model/useVisibilityEditor';
import { AppPresentationForm } from './AppPresentationForm';
import { AppVisibilityForm } from './AppVisibilityForm';
import { VisibilityCheck } from './VisibilityCheck';
import styles from './Visibility.module.css';

interface SettingsProps {
  readonly projectId: string;
  readonly visibility: AppVisibilityDto;
  readonly presentation: AppPresentationDto;
  readonly canConfigure: boolean;
  readonly unavailable: boolean;
  readonly reload: () => Promise<unknown>;
}

/** 两个独立修订共用一次导航确认，成功保存只清除所属草稿。读取失败保留已挂载编辑器。 */
export function AppVisibilitySettings({ projectId, visibility, presentation, canConfigure, unavailable, reload }: SettingsProps) {
  const t = useT(), [discard, setDiscard] = useState<'scope' | 'presentation'>();
  const panel = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement | null>(null);
  const canSave = canConfigure && !unavailable && !discard;
  const scopeEditor = useVisibilityEditor(projectId, visibility, reload, canSave);
  const presentationEditor = usePresentationEditor(projectId, presentation, reload, canSave);
  const pending = scopeEditor.save.isPending || presentationEditor.save.isPending;
  const dirty = scopeEditor.dirty || presentationEditor.dirty;
  const requestDiscard = (kind: 'scope' | 'presentation', button: HTMLButtonElement) => {
    if (pending) return;
    const editor = kind === 'scope' ? scopeEditor : presentationEditor;
    if (!editor.dirty) { editor.cancel(); return; }
    trigger.current = button; setDiscard(kind);
  };
  const finishDiscard = (confirmed: boolean) => {
    if (confirmed && discard) (discard === 'scope' ? scopeEditor : presentationEditor).cancel();
    setDiscard(undefined);
  };
  useEffect(() => {
    if (discard) panel.current?.querySelector<HTMLButtonElement>('button:last-child')?.focus();
    else { trigger.current?.focus(); trigger.current = null; }
  }, [discard]);
  return <div className={styles.stack}>
    <UnsavedChangesGuard dirty={dirty || pending} scope={t('projects.visibility.title')} />
    {unavailable ? <ActionNote tone="neutral">{t('projects.visibility.unavailable')}</ActionNote> : !canConfigure && dirty ? <ActionNote tone="neutral">{t('projects.visibility.roleChanged')}</ActionNote> : null}
    {pending ? <ActionNote tone="neutral">{t('projects.visibility.pendingNote')}</ActionNote> : null}
    {discard ? <div ref={panel}><ConfirmationPanel question={t('projects.visibility.discardQuestion', { scope: t(`projects.visibility.${discard}`) })} hint={t('projects.visibility.discardHint')} confirmLabel={t('projects.visibility.discard')} cancelLabel={t('ui.draft.stay')} onConfirm={() => finishDiscard(true)} onCancel={() => finishDiscard(false)} /></div> : null}
    <Card compact title={t('projects.visibility.scope')}><AppVisibilityForm projectId={projectId} saved={visibility} editor={scopeEditor} canConfigure={canConfigure} frozen={Boolean(discard)} cancelDisabled={pending} onCancel={(button) => requestDiscard('scope', button)} /></Card>
    <Card compact title={t('projects.visibility.presentation')}><AppPresentationForm saved={presentation} editor={presentationEditor} canConfigure={canConfigure} frozen={Boolean(discard)} cancelDisabled={pending} onCancel={(button) => requestDiscard('presentation', button)} /></Card>
    {canConfigure && !unavailable ? <Card compact title={t('projects.visibility.check')}><VisibilityCheck projectId={projectId} revision={visibility.revision} /></Card> : null}
  </div>;
}
