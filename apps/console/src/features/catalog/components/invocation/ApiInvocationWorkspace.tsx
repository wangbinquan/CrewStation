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
import { InlineBinding } from './InlineBinding';
import styles from './ApiInvocation.module.css';

export interface ApiInvocationSlots {
  readonly controller: ApiInvocationController;
  readonly open: (operation: ApiOperationDto) => void;
  /** 会话绑定、切换确认、表单与结果。 */
  readonly panel: ReactNode;
  /** 正在试调的操作；侧栏形态把 `panel` 展开在它那一行下面。 */
  readonly active?: ApiOperationDto;
}

/**
 * 试调工作区：会话绑定、表单与结果合成一个 `panel` 交给调用方摆放（侧栏形态在该行下原地展开，放大形态在详情栏）。
 * `inline`（侧栏形态）：还没打开试调时不摆会话绑定卡，只在打不开时给出原因。
 */
export function ApiInvocationWorkspace({ context, inline = false, children }: { readonly context: ApiInvocationContext; readonly inline?: boolean; readonly children: (slots: ApiInvocationSlots) => ReactNode }) {
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
  const panel = <>
    {inline && !selected && controller.error ? <ActionNote tone="error">{controller.error}</ActionNote> : null}
    {inline && selected ? <InlineBinding controller={controller} canDevelop={context.canDevelop} draftHidden={!visible} onRestore={() => setVisible(true)} /> : null}
    {!inline && (context.canDevelop || selected) ? <Card stacked compact title={t('catalog.invoke.title')} extra={<Button disabled={controller.pending || controller.checking || controller.session.isFetching || !context.canDevelop} onClick={() => { void controller.rebind(); }}>{t('catalog.invoke.rebind')}</Button>}>
      <p className={styles.note}>{t('catalog.invoke.scope')}</p>
      {selected || controller.taskId ? <p className={styles.note}>{t('catalog.invoke.limits')}</p> : <details><summary>{t('catalog.invoke.limitsTitle')}</summary><p className={styles.note}>{t('catalog.invoke.limits')}</p></details>}
      <p className={styles.note}>{controller.taskId ? <>{t('catalog.invoke.boundTask')} <code>{controller.taskId}</code></> : t('catalog.invoke.notBound')}</p>
      {controller.taskId && controller.taskId !== controller.currentTaskId ? <ActionNote tone="error">{t('catalog.invoke.sessionChanged')}</ActionNote> : null}
      {controller.error ? <ActionNote tone="error">{controller.error}</ActionNote> : null}
      {controller.pending ? <p role="status">{t('catalog.invoke.pendingHint')}</p> : null}
      {selected && !visible ? <Button onClick={() => setVisible(true)}>{t('catalog.invoke.restoreDraft')}</Button> : null}
    </Card> : null}
    {replacement ? <ConfirmationPanel question={t('catalog.invoke.replaceQuestion', { operation: `${replacement.method} ${replacement.path}` })} hint={t('catalog.invoke.replaceHint')} confirmLabel={t('catalog.invoke.replace')} cancelLabel={t('catalog.invoke.keep')} busy={controller.pending || controller.checking} onConfirm={() => choose(replacement)} onCancel={() => setReplacement(undefined)} /> : null}
    {selected ? <div ref={formHost} hidden={!visible}><ApiInvocationForm key={selected.id} inline={inline} operation={selected} controller={controller} onClose={() => setVisible(false)} /></div> : null}
    {controller.outcome ? <ApiInvocationResult outcome={controller.outcome} label={describe(context.operations, controller.outcome.request.operationId)} /> : null}
  </>;
  return <>
    <UnsavedChangesGuard dirty={controller.dirty || controller.pending} scope={t('catalog.invoke.draftScope')} />
    {children({ controller, open, panel, active: selected })}
  </>;
}

function describe(operations: readonly ApiOperationDto[], id: string): string | undefined {
  const operation = operations.find((item) => item.id === id);
  return operation ? `${operation.method} ${operation.path}` : undefined;
}
