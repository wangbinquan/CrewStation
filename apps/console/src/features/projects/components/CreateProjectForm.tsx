import type { ProjectDto } from '@crewstation/contracts';
import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
import { useT } from '../../../shared/lib/useT';
import { errorMessage } from '../../../shared/api/useApi';
import { UnsavedChangesGuard } from '../../../shared/navigation/UnsavedChangesGuard';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Button } from '../../../shared/ui/Button';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { useProjectCreation } from '../hooks/useProjectCreation';
import type { CreationScope } from '../model/creationDraft';
import { CreationBasics, CreationResources } from './creation/CreationFields';
import styles from './CreateProjectForm.module.css';

export interface CreateProjectFormProps { scope: CreationScope; open: boolean; self?: boolean; returnFocusTo?: RefObject<HTMLElement | null>; onClose(): void; onCreated(project: ProjectDto): void }

/** 同列表的常驻草稿，只在打开时呈现共享表单弹窗。 */
export function CreateProjectForm({ scope, open, self = false, returnFocusTo, onClose, onCreated }: CreateProjectFormProps) {
  const t = useT(), state = useProjectCreation(scope, onCreated, open, self);
  const { draft, errors, catalog, create } = state;
  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => { focusRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }, [errors]);
  const fields = { draft, errors, catalog, scope, self, defaultTasks: state.settings?.maxConcurrentTasks, disabled: create.isPending || state.unknown || state.reconciling, setField: state.setField };
  return <>
    <UnsavedChangesGuard dirty={state.dirty} scope={t(`projects.wizard.title.${scope}`)}
      allowNavigate={(current, next) => current.pathname === next.pathname} isNavigationBusy={() => create.isPending || state.reconciling} onDiscard={state.clear} />
    {open ? <FormDialog title={t(`projects.wizard.title.${scope}`)} size="large" returnFocusTo={returnFocusTo} onClose={onClose} onSubmit={() => void state.submit()} onClear={state.unknown ? undefined : state.clear}
      submitLabel={t('projects.create.submit')} busyLabel={t('projects.create.submitting')} busy={create.isPending || state.reconciling} submitDisabled={!state.available || state.unknown} dirty={state.dirty}
      error={create.error ? t('projects.create.error', { message: errorMessage(create.error) }) : state.resultError}>
      <div ref={focusRef} className={styles.content}>
        <p className={styles.intro}>{t('projects.creation.intro')}</p>
        <QueryStatus isPending={state.pending} error={state.error} loadingKey="projects.wizard.catalogLoading" errorKey="projects.wizard.catalogError" />
        <CreationBasics {...fields} /><CreationResources {...fields} />
        <p className={styles.next}><span aria-hidden="true">↗</span>{t('projects.creation.next')}</p>
        {catalog.templates.find((item) => item.id === draft.template)?.requiredConfig.length ? <p className={styles.intro}>{t('projects.wizard.creationEffect')}</p> : null}
        {state.unknown ? <ActionNote tone="neutral">{t('projects.wizard.resultUnknown')} <Button disabled={state.reconciling} onClick={() => void state.reconcile()}>{t('projects.self.reconcile')}</Button></ActionNote> : null}
        {create.isPending ? <ActionNote tone="neutral">{t('projects.wizard.pendingNote')}</ActionNote> : null}
      </div>
    </FormDialog> : null}
  </>;
}
