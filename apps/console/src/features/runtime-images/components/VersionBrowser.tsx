import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { FormField } from '../../../shared/ui/FormField';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import styles from './RuntimeImages.module.css';

/** 按目录与版本两步选择，避免为项目内所有镜像同时加载全部历史版本。 */
export function VersionBrowser({ projectId, onSelect }: { readonly projectId: string; readonly onSelect: (id: string) => void }) {
  const t = useT(), [before, setBefore] = useState<string>(), [imageId, setImageId] = useState('');
  const images = useApiQuery(['runtime-images', projectId, 'choose', before], () => api.runtimeImages.list(projectId, { before, limit: 20 }), AUTO_REFRESH);
  return <div className={styles.stack}>
    <FormField label={t('images.chooseImage')}><select value={imageId} onChange={(event) => setImageId(event.target.value)}>
      <option value="">{t('images.selectImage')}</option>
      {images.data?.items.filter((image) => image.enabled).map((image) => <option key={image.id} value={image.id}>{image.name}</option>)}
    </select></FormField>
    <QueryStatus isPending={images.isPending} error={images.error} />
    <div className={styles.row}>
      {before ? <Button onClick={() => { setBefore(undefined); setImageId(''); }}>{t('images.first')}</Button> : null}
      {images.data?.items.length === 20 ? <Button onClick={() => { setBefore(images.data!.items.at(-1)!.id); setImageId(''); }}>{t('images.next')}</Button> : null}
    </div>
    {imageId ? <Versions key={imageId} projectId={projectId} imageId={imageId} onSelect={onSelect} /> : null}
  </div>;
}

function Versions({ projectId, imageId, onSelect }: { readonly projectId: string; readonly imageId: string; readonly onSelect: (id: string) => void }) {
  const t = useT(), [before, setBefore] = useState<string>(), [versionId, setVersionId] = useState('');
  const versions = useApiQuery(['runtime-images', projectId, imageId, 'choose-version', before], () => api.runtimeImages.versions(projectId, imageId, { before, limit: 20 }), AUTO_REFRESH);
  const available = versions.data?.items.filter((version) => version.state === 'available') ?? [];
  return <div className={styles.stack}>
    <FormField label={t('images.version')}><select value={versionId} onChange={(event) => setVersionId(event.target.value)}>
      <option value="">{t('images.selectVersion')}</option>
      {available.map((version) => <option key={version.id} value={version.id}>{version.architecture} · {version.digest.slice(7, 19)} · …{version.id.slice(-8)}</option>)}
    </select></FormField>
    <QueryStatus isPending={versions.isPending} error={versions.error} />
    <div className={styles.row}>
      <Button disabled={!!versions.error || !available.some((version) => version.id === versionId)} onClick={() => onSelect(versionId)}>{t('images.useVersion')}</Button>
      {before ? <Button onClick={() => { setBefore(undefined); setVersionId(''); }}>{t('images.first')}</Button> : null}
      {versions.data?.items.length === 20 ? <Button onClick={() => { setBefore(versions.data!.items.at(-1)!.id); setVersionId(''); }}>{t('images.next')}</Button> : null}
    </div>
  </div>;
}
