import type { AppPresentationDto, AppVisibilityDto } from '@crewstation/contracts';
import { useState } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { usePresentationEditor } from '../../model/usePresentationEditor';
import { useVisibilityEditor } from '../../model/useVisibilityEditor';
import { AppPresentationDialog, AppPresentationSummary } from './AppPresentationDialog';
import { AppVisibilityDialog, AppVisibilitySummary } from './AppVisibilityDialog';
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

/**
 * 应用展示：卡片只显示已保存的一版，「修改展示资料」「修改可见范围」各开一个弹窗（2026-09-23 起）。
 * 原第三张卡「检查保存后的效果」连同后端检查接口已删除（2026-09-23 作者裁定）：可见范围只有三种，谁能看到由范围卡与成员页直接读出。
 * 两份草稿都在这一层：关窗不丢、再打开恢复，成功保存只清除所属草稿；离开页面共用一次确认，写明哪几份会丢。读取失败保留草稿。
 */
export function AppVisibilitySettings({ projectId, visibility, presentation, canConfigure, unavailable, refreshing = false, reload }: SettingsProps) {
  const t = useT(), [open, setOpen] = useState<'scope' | 'presentation'>();
  const canSave = canConfigure && !unavailable && !refreshing;
  const scopeEditor = useVisibilityEditor(projectId, visibility, reload, canSave, () => setOpen(undefined));
  const presentationEditor = usePresentationEditor(projectId, presentation, reload, canSave, () => setOpen(undefined));
  const pending = scopeEditor.save.isPending || presentationEditor.save.isPending;
  const dirty = scopeEditor.dirty || presentationEditor.dirty;
  const drafts = [presentationEditor.dirty ? t('projects.visibility.presentation') : undefined, scopeEditor.dirty ? t('projects.visibility.scope') : undefined].filter(Boolean);
  // 读取失败、后台重读或失去配置权限时仍能打开弹窗查看自己的草稿，只是保存暂停（canSubmit）；没有权限又没有草稿时不给入口。
  const available = (kind: 'scope' | 'presentation') => canConfigure || (kind === 'scope' ? scopeEditor : presentationEditor).dirty;
  const opener = (kind: 'scope' | 'presentation') => available(kind)
    ? <Button disabled={pending} onClick={() => setOpen(kind)}>{t(kind === 'scope' ? 'projects.visibility.editScope' : 'projects.visibility.editPresentation')}</Button> : null;
  return <div className={styles.stack}>
    <UnsavedChangesGuard dirty={dirty || pending} scope={drafts.join(t('projects.visibility.separator')) || t('projects.visibility.title')} />
    {unavailable ? <ActionNote tone="neutral">{t('projects.visibility.unavailable')}</ActionNote> : !canConfigure && dirty ? <ActionNote tone="neutral">{t('projects.visibility.roleChanged')}</ActionNote> : null}
    {pending ? <ActionNote tone="neutral">{t('projects.visibility.pendingNote')}</ActionNote> : null}
    <Card stacked compact title={t('projects.visibility.presentation')} actions={opener('presentation')}>
      <AppPresentationSummary saved={presentation} />
      {open !== 'presentation' && presentationEditor.save.isSuccess ? <ActionNote tone="success">{t('projects.visibility.saved')}</ActionNote> : null}
    </Card>
    <Card stacked compact title={t('projects.visibility.scope')} actions={opener('scope')}>
      <AppVisibilitySummary saved={visibility} canConfigure={canConfigure} />
      {open !== 'scope' && scopeEditor.save.isSuccess ? <ActionNote tone="success">{t('projects.visibility.saved')}</ActionNote> : null}
    </Card>
    {open === 'presentation' && available('presentation') ? <AppPresentationDialog saved={presentation} editor={presentationEditor} onClose={() => setOpen(undefined)} /> : null}
    {open === 'scope' && available('scope') ? <AppVisibilityDialog projectId={projectId} saved={visibility} editor={scopeEditor} onClose={() => setOpen(undefined)} /> : null}
  </div>;
}
