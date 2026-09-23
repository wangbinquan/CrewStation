import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import type { ApiInvocationController } from '../../hooks/useApiInvocation';
import styles from './ApiInvocation.module.css';

/**
 * 侧栏里行下展开的试调：会话绑定压成一行（真实调用的提醒、是否已绑定、重新绑定），限制折起来；
 * 会话 ID 只放在悬停提示里——人要确认的是「绑的是当前会话」，不是那串 ID。
 */
export function InlineBinding({ controller, canDevelop, draftHidden, onRestore }: { readonly controller: ApiInvocationController; readonly canDevelop: boolean; readonly draftHidden: boolean; readonly onRestore: () => void }) {
  const t = useT();
  return <div className={styles.binding}>
    <p className={styles.bindingLine}>
      <Badge tone="warning">{t('catalog.invoke.real')}</Badge>
      <span>{t('catalog.invoke.inlineScope')}</span>
      <span title={controller.taskId}>{t(controller.taskId ? 'catalog.invoke.inlineBound' : 'catalog.invoke.notBound')}</span>
      <Button size="small" variant="ghost" disabled={controller.pending || controller.checking || controller.session.isFetching || !canDevelop} onClick={() => { void controller.rebind(); }}>{t('catalog.invoke.rebind')}</Button>
    </p>
    <details><summary className={styles.note}>{t('catalog.invoke.limitsTitle')}</summary><p className={styles.note}>{t('catalog.invoke.limits')}</p></details>
    {controller.taskId && controller.taskId !== controller.currentTaskId ? <ActionNote tone="error">{t('catalog.invoke.sessionChanged')}</ActionNote> : null}
    {controller.error ? <ActionNote tone="error">{controller.error}</ActionNote> : null}
    {controller.pending ? <p role="status">{t('catalog.invoke.pendingHint')}</p> : null}
    {draftHidden ? <div><Button size="small" onClick={onRestore}>{t('catalog.invoke.restoreDraft')}</Button></div> : null}
  </div>;
}
