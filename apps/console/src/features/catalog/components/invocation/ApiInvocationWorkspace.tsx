import type { ApiOperationDto } from '@crewstation/contracts';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { ConfirmationPanel } from '../../../../shared/ui/ConfirmationPanel';
import { useApiInvocation } from '../../hooks/useApiInvocation';
import type { ApiInvocationContext, ApiInvocationController } from '../../hooks/useApiInvocation';
import { ApiInvocationForm } from './ApiInvocationForm';
import { ApiInvocationResult } from './ApiInvocationResult';
import styles from './ApiInvocation.module.css';

export function ApiInvocationWorkspace({ context, children }: { readonly context: ApiInvocationContext; readonly children: (controller: ApiInvocationController, open: (operation: ApiOperationDto) => void) => ReactNode }) {
  const t = useT(), controller = useApiInvocation(context);
  const [selected, setSelected] = useState<ApiOperationDto>(), [replacement, setReplacement] = useState<ApiOperationDto>(), [visible, setVisible] = useState(true);
  const formHost = useRef<HTMLDivElement>(null);
  useEffect(() => { if (visible && selected) formHost.current?.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled)')?.focus(); }, [selected, visible]);
  const choose = (operation: ApiOperationDto) => { setSelected(operation); setVisible(true); controller.clearDirty('detail'); setReplacement(undefined); };
  const open = (operation: ApiOperationDto) => {
    if (!controller.begin()) return;
    if (selected?.id === operation.id) { setVisible(true); return; }
    if (selected && controller.dirtySources.includes('detail')) setReplacement(operation); else choose(operation);
  };
  return <>
    <UnsavedChangesGuard dirty={controller.dirty || controller.pending} scope={t('catalog.invoke.draftScope')} />
    {context.canDevelop || selected ? <Card stacked compact title={t('catalog.invoke.title')} extra={<Button disabled={controller.pending || controller.checking || controller.session.isFetching || !context.canDevelop} onClick={() => { void controller.rebind(); }}>{t('catalog.invoke.rebind')}</Button>}>
      <p className={styles.note}>{t('catalog.invoke.scope')}</p>
      {selected || controller.taskId ? <p className={styles.note}>{t('catalog.invoke.limits')}</p> : <details><summary>{t('catalog.invoke.limitsTitle')}</summary><p className={styles.note}>{t('catalog.invoke.limits')}</p></details>}
      <p className={styles.note}>{controller.taskId ? <>{t('catalog.invoke.boundTask')} <code>{controller.taskId}</code></> : t('catalog.invoke.notBound')}</p>
      {controller.taskId && controller.taskId !== controller.currentTaskId ? <ActionNote tone="error">{t('catalog.invoke.sessionChanged')}</ActionNote> : null}
      {controller.error ? <ActionNote tone="error">{controller.error}</ActionNote> : null}
      {controller.pending ? <p role="status">{t('catalog.invoke.pendingHint')}</p> : null}
      {selected && !visible ? <Button onClick={() => setVisible(true)}>{t('catalog.invoke.restoreDraft')}</Button> : null}
    </Card> : null}
    {replacement ? <ConfirmationPanel question={t('catalog.invoke.replaceQuestion', { operation: replacement.id })} hint={t('catalog.invoke.replaceHint')} confirmLabel={t('catalog.invoke.replace')} cancelLabel={t('catalog.invoke.keep')} busy={controller.pending || controller.checking} onConfirm={() => choose(replacement)} onCancel={() => setReplacement(undefined)} /> : null}
    {selected ? <div ref={formHost} hidden={!visible}><ApiInvocationForm key={selected.id} operation={selected} controller={controller} onClose={() => setVisible(false)} /></div> : null}
    {controller.outcome ? <ApiInvocationResult outcome={controller.outcome} /> : null}
    {children(controller, open)}
  </>;
}
