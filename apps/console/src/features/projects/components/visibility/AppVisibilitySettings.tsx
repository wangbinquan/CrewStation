import type { AppPresentationDto, AppVisibilityDto } from '@crewstation/contracts';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
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
  /** 后台重读中：暂停提交但不显示“暂不能保存”。 */
  readonly refreshing?: boolean;
  readonly reload: () => Promise<unknown>;
}

/** 两个独立修订共用一次导航确认，成功保存只清除所属草稿。读取失败保留已挂载编辑器。 */
export function AppVisibilitySettings({ projectId, visibility, presentation, canConfigure, unavailable, refreshing = false, reload }: SettingsProps) {
  const t = useT(), [discard, setDiscard] = useState<'scope' | 'presentation'>();
  const panel = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement | null>(null);
  const [editing, setEditing] = useState({ scope: false, presentation: false });
  const openers = useRef<Partial<Record<'scope' | 'presentation', HTMLButtonElement>>>({});
  const close = (kind: 'scope' | 'presentation') => { setEditing((current) => ({ ...current, [kind]: false })); requestAnimationFrame(() => openers.current[kind]?.focus()); };
  const open = (kind: 'scope' | 'presentation', button: HTMLButtonElement) => { openers.current[kind] = button; setEditing((current) => ({ ...current, [kind]: true })); };
  const canSave = canConfigure && !unavailable && !refreshing && !discard;
  const scopeEditor = useVisibilityEditor(projectId, visibility, reload, canSave, () => close('scope'));
  const presentationEditor = usePresentationEditor(projectId, presentation, reload, canSave, () => close('presentation'));
  const pending = scopeEditor.save.isPending || presentationEditor.save.isPending;
  const dirty = scopeEditor.dirty || presentationEditor.dirty;
  const requestDiscard = (kind: 'scope' | 'presentation', button: HTMLButtonElement) => {
    if (pending) return;
    const editor = kind === 'scope' ? scopeEditor : presentationEditor;
    if (!editor.dirty) { editor.cancel(); close(kind); return; }
    trigger.current = button; setDiscard(kind);
  };
  const finishDiscard = (confirmed: boolean) => {
    if (confirmed && discard) { (discard === 'scope' ? scopeEditor : presentationEditor).cancel(); close(discard); trigger.current = null; }
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
    <Card stacked compact title={t('projects.visibility.presentation')} actions={canConfigure ? <Button hidden={editing.presentation} ref={(node) => { if (node) openers.current.presentation = node; }} disabled={pending || unavailable || refreshing || Boolean(discard)} onClick={(event) => open('presentation', event.currentTarget)}>{t('projects.visibility.editPresentation')}</Button> : null}><AppPresentationForm saved={presentation} editor={presentationEditor} editing={editing.presentation} canConfigure={canConfigure} frozen={Boolean(discard)} cancelDisabled={pending} onCancel={(button) => requestDiscard('presentation', button)} />{!editing.presentation && presentationEditor.save.isSuccess ? <ActionNote tone="success">{t('projects.visibility.saved')}</ActionNote> : null}</Card>
    <Card stacked compact title={t('projects.visibility.scope')} actions={canConfigure ? <Button hidden={editing.scope} ref={(node) => { if (node) openers.current.scope = node; }} disabled={pending || unavailable || refreshing || Boolean(discard)} onClick={(event) => open('scope', event.currentTarget)}>{t('projects.visibility.editScope')}</Button> : null}><AppVisibilityForm projectId={projectId} saved={visibility} editor={scopeEditor} editing={editing.scope} canConfigure={canConfigure} frozen={Boolean(discard)} cancelDisabled={pending} onCancel={(button) => requestDiscard('scope', button)} />{!editing.scope && scopeEditor.save.isSuccess ? <ActionNote tone="success">{t('projects.visibility.saved')}</ActionNote> : null}</Card>
    {canConfigure && !unavailable ? <Card stacked compact title={t('projects.visibility.check')}><VisibilityCheck projectId={projectId} revision={visibility.revision} /></Card> : null}
  </div>;
}
