import type { ApiOperationDto } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { InlineConfirm } from '../../../../shared/ui/InlineConfirm';
import type { CatalogManagementActions } from '../../hooks/useCatalogManagementActions';
import styles from '../OperationsPanel.module.css';

export function CatalogPolicyActions({ operation, serviceId, projectName, actions }: {
  readonly operation: ApiOperationDto; readonly serviceId?: string; readonly projectName?: string; readonly actions: CatalogManagementActions;
}) {
  const t = useT(), target = operation.openPolicy === 'default' ? 'targeted' : 'default';
  const busy = actions.setPolicy.isPending || actions.revoke.isPending;
  return <div className={styles.rowActions}>
    <InlineConfirm label={t(target === 'default' ? 'catalog.admin.toDefault' : 'catalog.admin.toTargeted')}
      question={t('catalog.admin.policyConfirm', { key: operation.id, policy: t(`catalog.policy.${target}`) })} busy={busy}
      onConfirm={() => actions.setPolicy.mutate({ operationId: operation.id, openPolicy: target })} />
    {serviceId && operation.granted === true ? <InlineConfirm label={t('catalog.admin.revoke')}
      question={t('catalog.admin.revokeServiceConfirm', { name: projectName ?? serviceId, key: operation.id }) + (operation.openPolicy === 'default' ? t('catalog.admin.defaultStillOpen') : '')}
      busy={busy} onConfirm={() => actions.revoke.mutate({ serviceId, operationId: operation.id })} /> : null}
  </div>;
}
