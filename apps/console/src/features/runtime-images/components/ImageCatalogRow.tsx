import { CatalogCell } from '../../../shared/ui/catalog/CatalogCell';
import { useDateText } from '../../../shared/lib/useDateText';
import type { RuntimeImageDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import styles from '../../../shared/ui/CapabilityCatalog.module.css';

export function ImageCatalogRow({ projectId, image, editable, onOpen, projectName }: { readonly projectName?: string; readonly projectId: string | undefined; readonly image: RuntimeImageDto; readonly editable: boolean; readonly onOpen: () => void }) {
  const t = useT(), date = useDateText(), key = ['runtime-images', projectId, image.id];
  const versions = useApiQuery([...key, 'latest-version'], () => api.runtimeImages.versions(projectId, image.id, { limit: 1 }), AUTO_REFRESH);
  const builds = useApiQuery([...key, 'latest-build'], () => api.runtimeImages.builds(projectId, image.id, { limit: 1 }), { ...AUTO_REFRESH, enabled: editable && projectId === undefined });
  const version = versions.data?.items[0], build = builds.data?.items[0];
  const checks = useApiQuery([...key, 'validations', version?.id], () => api.runtimeImages.validations(projectId, image.id, version!.id), { ...AUTO_REFRESH, enabled: !!version && editable });
  return <tr className={styles.profileRow}><td><div className={styles.nameLine}><code>{image.name}</code><small className={styles.hint}>{t(projectId !== undefined ? 'images.businessAvailable' : image.defaultVisible ? 'images.defaultVisible' : 'images.defaultHidden')}{!image.enabled ? ` · ${t('images.disabled')}` : ''}</small></div>{projectName ? <p className={styles.hint}>{projectName}</p> : null}{image.description ? <p className={styles.description}>{image.description}</p> : null}</td>
    <CatalogCell label={t('images.latestVersion')}><div className={styles.rowStack}><QueryStatus isPending={versions.isPending} error={versions.error || checks.error} />{version ? <><code>{version.digest.slice(0, 19)} · {version.architecture}</code><span>{t(`images.state.${version.state}`)}</span>
      {!editable ? <p className={styles.hint}>{t('images.validationAccess')}</p> : checks.data ? checks.data.items[0] ? <p className={styles.hint}>{t('images.lastValidation')} · {t(`images.usage.${checks.data.items[0].target.usage}`)} · {t(`images.state.${checks.data.items[0].state}`)}</p> : <p className={styles.hint}>{t('images.notValidated')}</p> : <QueryStatus isPending={checks.isPending} error={null} />}</> : versions.data ? t('images.noVersion') : null}</div></CatalogCell>
    {projectId === undefined ? <CatalogCell label={t('images.latestBuild')}><div className={styles.status}>{build ? <><span>{t(`images.state.${build.state}`)}</span><small>{date(build.updatedAt)}</small>{build.error ? <p className={styles.hint}>{build.error}</p> : null}</> : builds.data ? <span className={styles.hint}>{t('images.noBuild')}</span> : <QueryStatus isPending={builds.isPending} error={builds.error} />}</div></CatalogCell> : null}
    <td><div className={styles.rowActions}><Button size="small" onClick={onOpen}>{t('images.open')}</Button></div></td></tr>;
}
