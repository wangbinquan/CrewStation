import { useDeferredValue } from 'react';
import { ProjectDomainPreviewSchema, SlugSchema } from '@crewstation/contracts';
import type { ManifestKind } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import styles from '../CreateProjectForm.module.css';

export function CreationDomainPreview({ slug, kind }: { slug: string; kind: ManifestKind }) {
  const t = useT(), input = slug.trim(), deferred = useDeferredValue(input), valid = SlugSchema.safeParse(input).success;
  const query = useApiQuery(['project-domain-preview', deferred], async () => {
    const result = ProjectDomainPreviewSchema.parse(await api.catalog.projectDomainPreview(deferred));
    if (result.slug !== deferred) throw new Error(t('projects.creation.domains.error'));
    return result;
  }, { enabled: SlugSchema.safeParse(deferred).success });
  const result = valid && query.data?.slug === input && !query.error ? query.data : undefined;
  const message = !input ? 'empty' : !valid ? 'invalid' : query.error && deferred === input ? query.error.status === 400 ? 'invalid' : 'error' : 'loading';
  return <div className={styles.domains} aria-live="polite" data-testid="creation-domain-preview">
    <div className={styles.domainHeading}><strong>{t('projects.creation.domains.title')}</strong><Badge tone="info">{t(`projects.creation.domains.${result ? 'updated' : message}`)}</Badge></div>
    {result ? <div className={styles.domainGrid}>
      <div><span>{t('projects.creation.domains.prod')}</span><code>{result.prodHost}</code><small>{t('projects.creation.domains.prodHint')}</small></div>
      <div><span>{t('projects.creation.domains.preview')}</span><code>{result.previewHost}</code><small>{t('projects.creation.domains.previewHint')}</small></div>
      {kind !== 'DigitalWorker' ? <div><span>{t('projects.creation.domains.service')}</span><code>{result.serviceHost}</code><small>{t('projects.creation.domains.serviceHint')}</small></div> : null}
    </div> : <p>{t(`projects.creation.domains.${message}Hint`)}</p>}
  </div>;
}
