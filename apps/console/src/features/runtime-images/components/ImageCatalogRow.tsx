import { CatalogCell } from '../../../shared/ui/catalog/CatalogCell';
import { useDateText } from '../../../shared/lib/useDateText';
import type { RuntimeImageDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { ImageStateBadge } from './ImageStateBadge';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import styles from '../../../shared/ui/CapabilityCatalog.module.css';

export function ImageCatalogRow({ projectId, image, editable, onOpen, onEdit, projectName }: { readonly projectName?: string; readonly projectId: string | undefined; readonly image: RuntimeImageDto; readonly editable: boolean; readonly onOpen: () => void; readonly onEdit?: () => void }) {
  const t = useT(), date = useDateText(), key = ['runtime-images', projectId, image.id];
  const versions = useApiQuery([...key, 'latest-version'], () => api.runtimeImages.versions(projectId, image.id, { limit: 1 }), AUTO_REFRESH);
  const builds = useApiQuery([...key, 'latest-build'], () => api.runtimeImages.builds(projectId, image.id, { limit: 1 }), { ...AUTO_REFRESH, enabled: editable && projectId === undefined });
  const version = versions.data?.items[0], build = builds.data?.items[0];
  const checks = useApiQuery([...key, 'validations', version?.id], () => api.runtimeImages.validations(projectId, image.id, version!.id), { ...AUTO_REFRESH, enabled: !!version && editable });
  return <tr className={styles.profileRow}><td><div className={styles.nameLine}><code>{image.name}</code><small className={styles.hint}>{t(projectId !== undefined ? 'images.businessAvailable' : image.defaultVisible ? 'images.defaultVisible' : 'images.defaultHidden')}{!image.enabled ? ` · ${t('images.disabled')}` : ''}</small></div>{projectName ? <p className={styles.hint}>{projectName}</p> : null}{image.description ? <p className={styles.description}>{image.description}</p> : null}</td>
    <CatalogCell label={t('images.latestVersion')}><div className={styles.rowStack}><QueryStatus isPending={versions.isPending} error={versions.error} />{version ? <>
      <div className={styles.nameLine}><ImageStateBadge state={version.state} /><small className={styles.hint}>{version.architecture}</small></div>
      <code className={styles.model}>{version.digest.slice(0, 19)}</code>
      {projectId !== undefined && editable ? <><QueryStatus isPending={checks.isPending} error={checks.error} />{checks.data?.items[0] ? <div className={styles.nameLine}><ImageStateBadge state={checks.data.items[0].state} /><small className={styles.hint}>{t(`images.usage.${checks.data.items[0].target.usage}`)}</small></div> : checks.data ? <span className={styles.hint}>{t('images.notValidated')}</span> : null}</> : null}
      {projectId !== undefined && !editable ? <p className={styles.hint}>{t('images.validationAccess')}</p> : null}
    </> : versions.data ? <span className={styles.hint}>{t('images.noVersion')}</span> : null}</div></CatalogCell>
    {projectId === undefined ? <>
      <CatalogCell label={t('images.latestBuild')}><div className={styles.status}>{build ? <><ImageStateBadge state={build.state} /><small>{date(build.updatedAt)}</small>{build.error ? <p className={styles.description} title={build.error}>{build.error}</p> : null}</> : builds.data ? <span className={styles.hint}>{t('images.noBuild')}</span> : <QueryStatus isPending={builds.isPending} error={builds.error} />}</div></CatalogCell>
      <CatalogCell label={t('images.validationStatus')}><div className={styles.status}>
        <QueryStatus isPending={!!version && checks.isPending} error={checks.error} />
        {checks.data?.items[0] ? <><ImageStateBadge state={checks.data.items[0].state} /><small>{t(`images.usage.${checks.data.items[0].target.usage}`)}</small></> : versions.data && (!version || checks.data) ? <span className={styles.hint}>{t('images.notValidated')}</span> : null}
      </div></CatalogCell>
    </> : null}
    <td><div className={styles.rowActions}>
      {onEdit ? <Button size="small" aria-haspopup="dialog" onClick={onEdit}>{t('images.edit')}</Button> : null}
      <Button size="small" aria-haspopup="dialog" onClick={onOpen}>{t(onEdit ? 'images.moreActions' : 'images.open')}</Button>
    </div></td></tr>;
}
