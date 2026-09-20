import type { LoginPolicyDto } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { Card } from '../../../../shared/ui/Card';
import { InlineConfirm } from '../../../../shared/ui/InlineConfirm';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { Button } from '../../../../shared/ui/Button';
import { MutationError } from '../MutationError';
import styles from './IdentityAdmin.module.css';

function blockedReason(policy: LoginPolicyDto) {
  if (policy.callerAuthMethod !== 'oidc') return 'session';
  if (policy.enabledProviderCount < 1) return 'providers';
  return undefined;
}

/** 有效状态与保存策略分开呈现，安装强制开关不能伪装成可编辑的数据库状态。 */
export function LoginMethodsCard() {
  const t = useT(), policy = useApiQuery(queryKeys.loginPolicy(), () => api.auth.loginPolicy());
  const update = useApiMutation((passwordLoginEnabled: boolean) => api.auth.setLoginPolicy({ passwordLoginEnabled }), { invalidate: [queryKeys.loginPolicy()] });
  const data = policy.data, reason = data ? blockedReason(data) : undefined;
  const effectiveOn = data && (data.forcedOn || data.passwordLoginEnabled);
  return <Card stacked title={t('admin.identity.localLogin')}>
    <QueryStatus isPending={policy.isPending} error={policy.error} />
    {policy.error ? <Button onClick={() => void policy.refetch()}>{t('admin.identity.retry')}</Button> : null}
    {data ? <>
      <div className={styles.sectionHeading}><dl className={styles.summary}><div><dt>{t('admin.auth.passwordLogin')}</dt><dd><Badge tone={effectiveOn ? 'info' : 'neutral'}>{t(effectiveOn ? 'admin.auth.on' : 'admin.auth.off')}</Badge></dd></div></dl>
        {data.forcedOn || (data.passwordLoginEnabled && reason) ? null : data.passwordLoginEnabled ? <InlineConfirm
          label={t('admin.auth.disable')} question={t('admin.auth.disableQuestion')} confirmLabel={t('admin.auth.disableConfirm')} busy={update.isPending} busyLabel={t('admin.auth.saving')} onConfirm={() => update.mutate(false)} /> : <Button disabled={update.isPending} onClick={() => update.mutate(true)}>{t(update.isPending ? 'admin.auth.saving' : 'admin.auth.enable')}</Button>}
      </div>
      {data.forcedOn || (data.passwordLoginEnabled && reason) ? <p className={styles.muted}>{t(`admin.auth.blocked.${data.forcedOn ? 'forcedOn' : reason}`)}</p> : null}
      <dl className={styles.summary}>
        {data.forcedOn ? <div><dt>{t('admin.auth.storedPolicy')}</dt><dd>{t(data.passwordLoginEnabled ? 'admin.auth.on' : 'admin.auth.off')}</dd></div> : null}
        <div><dt>{t('admin.auth.currentSession')}</dt><dd>{t(data.callerAuthMethod === 'oidc' ? 'admin.auth.sessionOidc' : 'admin.auth.sessionPassword')}</dd></div>
        <div><dt>{t('admin.auth.enabledProviders')}</dt><dd>{data.enabledProviderCount}</dd></div>
        <div><dt>{t('admin.identity.initialization')}</dt><dd>{t(data.bootstrapCompletedAt ? 'admin.identity.initialized' : 'admin.identity.initializationPending')}</dd></div>
      </dl>
      <details className={styles.statusDetails}><summary>{t('admin.identity.initializationDetails')}</summary>
        <dl className={styles.summary}><div><dt>{t('admin.auth.bootstrapToken')}</dt><dd>{t(data.bootstrapCompletedAt ? 'admin.auth.bootstrapRetired' : 'admin.auth.bootstrapPending')}</dd></div></dl>
      </details>
    </> : null}
    <MutationError error={update.error} messageKey="admin.auth.policySaveError" />
  </Card>;
}
