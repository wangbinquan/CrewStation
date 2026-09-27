import type { RuntimeImageDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import styles from './RuntimeImages.module.css';

export function ImageCatalogRow({ projectId, image, editable, onOpen, projectName }: { readonly projectName?: string; readonly projectId: string; readonly image: RuntimeImageDto; readonly editable: boolean; readonly onOpen: () => void }) {
  const t = useT(), key = ['runtime-images', projectId, image.id];
  const versions = useApiQuery([...key, 'latest-version'], () => api.runtimeImages.versions(projectId, image.id, { limit: 1 }), AUTO_REFRESH);
  const builds = useApiQuery([...key, 'latest-build'], () => api.runtimeImages.builds(projectId, image.id, { limit: 1 }), { ...AUTO_REFRESH, enabled: editable && image.projectId === projectId });
  const version = versions.data?.items[0], build = builds.data?.items[0];
  const checks = useApiQuery([...key, 'validations', version?.id], () => api.runtimeImages.validations(projectId, image.id, version!.id), { ...AUTO_REFRESH, enabled: !!version && editable });
  return <tr><td><strong>{image.name}</strong>{projectName ? <p>{projectName}</p> : null}<p className={styles.note}>{image.description || t('images.noDescription')}</p><small>{t(`images.scope.${image.scope}`)}{!image.enabled ? ` · ${t('images.disabled')}` : ''}</small></td>
    <td><QueryStatus isPending={versions.isPending} error={versions.error || checks.error} />{version ? <><span>{version.digest.slice(0, 19)} · {version.architecture}</span><p>{t(`images.state.${version.state}`)}</p>
      {!editable ? <p>{t('images.validationAccess')}</p> : checks.data ? checks.data.items[0] ? <p>{t('images.lastValidation')} · {t(`images.usage.${checks.data.items[0].target.usage}`)} · {t(`images.state.${checks.data.items[0].state}`)}</p> : <p>{t('images.notValidated')}</p> : <QueryStatus isPending={checks.isPending} error={null} />}</> : versions.data ? t('images.noVersion') : null}</td>
    <td>{build ? <>{t(`images.state.${build.state}`)}<p>{new Date(build.updatedAt).toLocaleString()}</p>{build.error ? <p>{build.error}</p> : null}</> : <QueryStatus isPending={builds.isLoading} error={builds.error} />}</td>
    <td><Button size="small" onClick={onOpen}>{t('images.open')}</Button></td></tr>;
}
