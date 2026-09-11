import type { ManifestKind, UserDto } from '@crewstation/contracts';
import type { CreateProjectInput } from '@crewstation/api-client';
import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { FormField } from '../../../shared/ui/FormField';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import styles from './CreateProjectForm.module.css';

const KINDS: readonly ManifestKind[] = ['DigitalWorker', 'APIProxy', 'EventProducer'];
const EMPTY = { name: '', slug: '', ownerUserId: '', kind: 'DigitalWorker' as ManifestKind, template: 'minimal-sample' };

/** 管理员代建项目并指定负责人；平台随后异步跑开通链（仓库、命名空间、模板、首个标签）。 */
export function CreateProjectForm(): ReactElement {
  const t = useT();
  const [draft, setDraft] = useState(EMPTY);
  const users = useApiQuery(queryKeys.users(), () => api.users.list());
  const create = useApiMutation((input: CreateProjectInput) => api.projects.create(input), {
    invalidate: [queryKeys.projects()],
    onSuccess: () => setDraft(EMPTY),
  });
  // 负责人从用户目录里取整条记录，userId 的品牌类型因此不需要强制转换。
  const owner = (users.data?.items ?? []).find((user) => user.id === draft.ownerUserId);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (owner === undefined) return;
    create.mutate({ name: draft.name.trim(), slug: draft.slug.trim(), ownerUserId: owner.id, kind: draft.kind, template: draft.template.trim() });
  }

  return (
    <Card title={t('projects.create.title')}>
      <p className={styles.description}>{t('projects.create.description')}</p>
      <QueryStatus isPending={users.isPending} error={users.error} loadingKey="projects.create.usersLoading" errorKey="projects.create.usersError" />
      <form className={styles.form} onSubmit={submit}>
        <FormField label={t('projects.create.name')}>
          <input value={draft.name} required maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </FormField>
        <FormField label={t('projects.create.slug')} hint={t('projects.create.slugHint')}>
          <input value={draft.slug} required pattern="[a-z][a-z0-9-]{1,38}[a-z0-9]" onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
        </FormField>
        <FormField label={t('projects.create.owner')}>
          <select value={draft.ownerUserId} required onChange={(e) => setDraft({ ...draft, ownerUserId: e.target.value })}>
            <option value="">{t('projects.create.ownerPlaceholder')}</option>
            {(users.data?.items ?? []).map((user: UserDto) => (
              <option key={user.id} value={user.id}>{`${user.name}（${user.email}）`}</option>
            ))}
          </select>
        </FormField>
        <FormField label={t('projects.create.kind')}>
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as ManifestKind })}>
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`projects.kind.${kind}`)}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label={t('projects.create.template')}>
          <input value={draft.template} required onChange={(e) => setDraft({ ...draft, template: e.target.value })} />
        </FormField>
        <div className={styles.submit}>
          <Button type="submit" variant="primary" disabled={create.isPending || owner === undefined}>
            {create.isPending ? t('projects.create.submitting') : t('projects.create.submit')}
          </Button>
        </div>
      </form>
      {create.isError ? <ActionNote tone="error">{t('projects.create.error', { message: errorMessage(create.error) })}</ActionNote> : null}
      {create.isSuccess ? <ActionNote tone="success">{t('projects.create.success', { name: create.data.name })}</ActionNote> : null}
    </Card>
  );
}
