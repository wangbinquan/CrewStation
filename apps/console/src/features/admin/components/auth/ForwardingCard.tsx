import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { InlineConfirm } from '../../../../shared/ui/InlineConfirm';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { Stack } from '../../../../shared/ui/Stack';
import { MutationError } from '../MutationError';
import { ProjectOverrides } from './forwarding/ProjectOverrides';
import styles from './IdentityAdmin.module.css';

export function ForwardingCard() {
  const t = useT(), forwarding = useApiQuery(queryKeys.identityForwarding(), () => api.auth.forwarding());
  const update = useApiMutation((fields: string[]) => api.auth.setGlobalForwarding({ fields }), { invalidate: [queryKeys.identityForwarding()] });
  const data = forwarding.data, fields = data?.global.fields ?? [];
  const candidates = [...(data?.candidates ?? []), ...fields.filter((key) => !data?.candidates.some((candidate) => candidate.key === key)).map((key) => ({ key, kind: 'missing' as const, providers: [] }))];
  return <Stack>
    <Card stacked title={t('admin.auth.forwardingTitle')} footer={t('admin.auth.forwardingHint')}>
      <p className={styles.muted}>{t('admin.auth.forwardingFixed')}</p>
      <QueryStatus isPending={forwarding.isPending} error={forwarding.error} />
      {forwarding.error ? <Button onClick={() => void forwarding.refetch()}>{t('admin.identity.retry')}</Button> : null}
      <div>{candidates.map((candidate) => <div key={candidate.key} className={styles.fieldRow}>
        <div className={styles.providerDetails}><strong>{candidate.kind === 'fixed' ? t(`admin.auth.field.${candidate.key}`) : candidate.key}</strong><code className={styles.muted}>{candidate.key}</code></div>
        <div className={styles.providerDetails}><span className={styles.muted}>{t(candidate.kind === 'fixed' ? 'admin.auth.sourceFixed' : candidate.kind === 'mapped' ? 'admin.auth.sourceMapped' : 'admin.identity.unknownField')}{candidate.providers.length ? ` · ${candidate.providers.join(', ')}` : ''}</span><Badge tone={fields.includes(candidate.key) ? 'success' : 'neutral'}>{t(fields.includes(candidate.key) ? 'admin.identity.forwardingOn' : 'admin.identity.forwardingOff')}</Badge></div>
        {fields.includes(candidate.key) ? <InlineConfirm label={t('admin.auth.stopForwarding')} question={t('admin.auth.stopForwardingQuestion')} variant="ghost" busy={update.isPending} onConfirm={() => update.mutate(fields.filter((key) => key !== candidate.key))} /> : <Button variant="ghost" disabled={update.isPending || fields.length >= 40} onClick={() => update.mutate([...fields, candidate.key])}>{t('admin.auth.startForwarding')}</Button>}
      </div>)}</div>
      {fields.length >= 40 ? <p className={styles.muted}>{t('admin.identity.fieldsHint')}</p> : null}
      <MutationError error={update.error} messageKey="admin.auth.forwardingSaveError" />
    </Card>
    {data ? <ProjectOverrides data={data} /> : null}
  </Stack>;
}
