import type { ConfigEnv } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { errorMessage, isApiClientError } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { useConfigEnv } from '../hooks/useConfigEnv';
import { ConfigItemForm } from './ConfigItemForm';
import type { ConfigItemDraft } from './ConfigItemForm';
import { ConfigItemTable } from './ConfigItemTable';
import { ConfigVersionList } from './ConfigVersionList';
import styles from './ConfigEnvPanel.module.css';

const NEW_ITEM: ConfigItemDraft = { name: '', isSecret: false, overwrite: false };

export interface ConfigEnvPanelProps {
  readonly projectId: string;
  readonly env: ConfigEnv;
}

/** 一组取值的完整面板：列表、新增／覆盖表单、版本历史。生产组的 403 由服务端说明原样呈现。 */
export function ConfigEnvPanel({ projectId, env }: ConfigEnvPanelProps): ReactElement {
  const t = useT();
  const { items, versions, save, remove } = useConfigEnv(projectId, env);
  const [draft, setDraft] = useState<ConfigItemDraft>(NEW_ITEM);
  const [draftSeq, setDraftSeq] = useState(0);
  const list = items.data?.items ?? [];
  return (
    <Card
      title={t(`config.env.${env}`)}
      extra={<Badge tone={env === 'production' ? 'warning' : 'info'}>{t(`config.env.${env}Role`)}</Badge>}
      footer={
        <>
          <h3 className={styles.versionsTitle}>{t('config.versions.title')}</h3>
          <p className={styles.versionsNote}>{t('config.versions.note')}</p>
          <ConfigVersionList versions={versions.data?.items ?? []} pending={versions.isPending} />
        </>
      }
    >
      <p className={styles.note}>{t(`config.env.${env}Note`)}</p>
      {items.isPending ? <p className={styles.note}>{t('config.items.loading')}</p> : null}
      {items.error ? <p className={styles.error}>{t('config.error.load', { message: errorMessage(items.error) })}</p> : null}
      {!items.isPending && items.error === null && list.length === 0 ? (
        <EmptyState title={t('config.items.emptyTitle')} description={t('config.items.emptyDescription')} />
      ) : null}
      {list.length > 0 ? (
        <ConfigItemTable
          items={list}
          deletingName={remove.isPending ? remove.variables : undefined}
          onDelete={(name) => remove.mutate(name)}
          onEdit={(item) => {
            setDraft({ name: item.name, isSecret: item.isSecret, overwrite: true });
            setDraftSeq((seq) => seq + 1);
          }}
        />
      ) : null}
      <WriteError action="config.error.save" error={save.error} />
      <WriteError action="config.error.delete" error={remove.error} />
      <h3 className={styles.formTitle}>{t('config.form.title')}</h3>
      <ConfigItemForm key={`${draft.name}:${draftSeq}`} draft={draft} pending={save.isPending} onSubmit={(input) => save.mutate(input)} />
    </Card>
  );
}

/** 写失败的说明；403 另加一句“生产组由负责人维护”，控件保持可见而不是被藏起来。 */
function WriteError({ action, error }: { readonly action: string; readonly error: unknown }): ReactElement | null {
  const t = useT();
  if (error === null || error === undefined) return null;
  const forbidden = isApiClientError(error) && error.status === 403;
  return (
    <p className={styles.error}>
      {t(action, { message: errorMessage(error) })}
      {forbidden ? ` ${t('config.error.forbidden')}` : ''}
    </p>
  );
}
