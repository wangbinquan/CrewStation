import type { LoginPolicyDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { Card } from '../../../../shared/ui/Card';
import { DefinitionList } from '../../../../shared/ui/DefinitionList';
import { InlineConfirm } from '../../../../shared/ui/InlineConfirm';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { Button } from '../../../../shared/ui/Button';
import { MutationError } from '../MutationError';

/** 关不掉时的原因：三条前置缺哪一条就说哪一条，不给一个只是灰着的开关（RFC-005 §6.1）。 */
function blockedReason(policy: LoginPolicyDto): 'forcedOn' | 'session' | 'providers' | undefined {
  if (policy.forcedOn) return 'forcedOn';
  if (policy.callerAuthMethod !== 'oidc') return 'session';
  if (policy.enabledProviderCount < 1) return 'providers';
  return undefined;
}

/** 登录方式卡：常规登录的开关、引导令牌状态、当前会话的认证方式。 */
export function LoginMethodsCard(): ReactElement {
  const t = useT();
  const policy = useApiQuery(queryKeys.loginPolicy(), () => api.auth.loginPolicy());
  const update = useApiMutation((passwordLoginEnabled: boolean) => api.auth.setLoginPolicy({ passwordLoginEnabled }), { invalidate: [queryKeys.loginPolicy()] });
  const data = policy.data;
  const reason = data === undefined ? undefined : blockedReason(data);
  return (
    <Card title={t('admin.auth.methodsTitle')} footer={t('admin.auth.methodsHint')}>
      <MutationError error={update.error} messageKey="admin.auth.policySaveError" />
      <QueryStatus isPending={policy.isPending} error={policy.error} />
      {data === undefined ? null : (
        <>
          <DefinitionList
            items={[
              { label: t('admin.auth.passwordLogin'), value: <Badge tone={data.passwordLoginEnabled ? 'info' : 'neutral'}>{data.passwordLoginEnabled ? t('admin.auth.on') : t('admin.auth.off')}</Badge> },
              { label: t('admin.auth.bootstrapToken'), value: <Badge tone={data.bootstrapCompletedAt === null ? 'warning' : 'neutral'}>{data.bootstrapCompletedAt === null ? t('admin.auth.bootstrapPending') : t('admin.auth.bootstrapRetired')}</Badge> },
              { label: t('admin.auth.currentSession'), value: data.callerAuthMethod === 'oidc' ? t('admin.auth.sessionOidc') : t('admin.auth.sessionPassword') },
              { label: t('admin.auth.enabledProviders'), value: String(data.enabledProviderCount) },
            ]}
          />
          {data.passwordLoginEnabled ? (
            reason === undefined ? (
              <InlineConfirm
                label={t('admin.auth.disable')}
                question={t('admin.auth.disableQuestion')}
                confirmLabel={t('admin.auth.disableConfirm')}
                variant="secondary"
                busy={update.isPending}
                busyLabel={t('admin.auth.saving')}
                onConfirm={() => update.mutate(false)}
              />
            ) : (
              <p>{t(`admin.auth.blocked.${reason}`)}</p>
            )
          ) : (
            <Button variant="primary" disabled={update.isPending} onClick={() => update.mutate(true)}>
              {update.isPending ? t('admin.auth.saving') : t('admin.auth.enable')}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
