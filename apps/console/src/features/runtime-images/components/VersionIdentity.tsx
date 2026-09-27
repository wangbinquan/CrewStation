import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, errorMessage, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import styles from './RuntimeImages.module.css';

/** Name lookup describes the pinned version; failures never substitute the current default. */
export function VersionIdentity({ projectId, versionId, imageId }: { readonly projectId: string | undefined; readonly versionId: string; readonly imageId?: string }) {
  const t = useT();
  const detail = useApiQuery(['runtime-images', projectId, 'version', versionId], () => projectId ? api.runtimeImages.version(projectId, versionId) : api.runtimeImages.adminVersion(imageId!, versionId), { ...AUTO_REFRESH, enabled: !!projectId || !!imageId });
  return <span className={styles.identity} title={versionId}>{detail.data ? `${'name' in detail.data ? detail.data.name + ' · ' : ''}${detail.data.digest.slice(0, 19)} · ${detail.data.architecture}` : t('images.versionNumber', { id: versionId.slice(-12) })}
    {detail.error ? <span role="alert"> · {errorMessage(detail.error)}</span> : null}</span>;
}
