import type { PublishInput } from '@crewstation/api-client';
import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { FormField } from '../../../shared/ui/FormField';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { isPublishVersion } from '../model/releaseVersion';
import { BranchSelect } from './BranchSelect';
import { PublishResult } from './PublishResult';
import styles from './PublishForm.module.css';

export interface PublishFormProps {
  readonly serviceId: string;
  readonly projectId: string;
}

/** 发布：平台推送当前分支、打标签、构建固定 SHA、跑兼容迁移，再部署到待机的 preview 槽。 */
export function PublishForm({ serviceId, projectId }: PublishFormProps): ReactElement {
  const t = useT();
  const [branch, setBranch] = useState('');
  const [version, setVersion] = useState('patch');
  const slots = useApiQuery(queryKeys.slots(serviceId), () => api.services.listSlots(serviceId));
  const previewSha = slots.data?.items.find((slot) => slot.name === 'preview')?.commitSha;
  const prodSha = slots.data?.items.find((slot) => slot.name === 'prod')?.commitSha;
  // 两槽的提交进入查询键：槽变了要重新算落后数，而不是拿旧结果。
  const branches = useApiQuery(
    [...queryKeys.branches(projectId), previewSha ?? '', prodSha ?? ''],
    () => api.services.listBranches(serviceId, { previewSha, prodSha }),
    { enabled: !slots.isPending },
  );
  const items = branches.data?.items ?? [];
  const selected = branch !== '' ? branch : items.find((item) => item.isDefault)?.name ?? items[0]?.name ?? '';
  const publish = useApiMutation((input: PublishInput) => api.services.publish(serviceId, input), {
    invalidate: [queryKeys.releases(serviceId), queryKeys.slots(serviceId)],
  });
  const versionValid = isPublishVersion(version);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (selected === '' || !versionValid) return;
    publish.mutate({ branch: selected, version: version.trim() });
  }

  return (
    <Card title={t('release.publish.title')}>
      <QueryStatus isPending={branches.isPending} error={branches.error} loadingKey="release.publish.branchLoading" errorKey="release.publish.branchError" />
      <form className={styles.form} onSubmit={submit}>
        <FormField label={t('release.publish.branch')}>
          <BranchSelect branches={items} value={selected} onChange={setBranch} />
        </FormField>
        <FormField label={t('release.publish.version')} hint={t('release.publish.versionHint')}>
          <input value={version} required onChange={(event) => setVersion(event.target.value)} />
        </FormField>
        <div className={styles.submit}>
          <Button type="submit" variant="primary" disabled={publish.isPending || selected === '' || !versionValid}>
            {publish.isPending ? t('release.publish.submitting') : t('release.publish.submit')}
          </Button>
        </div>
      </form>
      {versionValid ? null : <ActionNote tone="neutral">{t('release.publish.versionInvalid')}</ActionNote>}
      <PublishResult error={publish.error} tag={publish.data?.tag} />
    </Card>
  );
}
