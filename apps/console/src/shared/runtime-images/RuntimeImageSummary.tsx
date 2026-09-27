import { useT } from '../lib/useT';
import styles from './RuntimeImageSummary.module.css';

/** 只显示执行受理时的镜像；不查询当前默认，避免历史执行被误标。 */
export function RuntimeImageSummary({ image, compact = false }: { readonly image?: string; readonly compact?: boolean }) {
  const t = useT();
  if (!image) return compact ? null : <span>—</span>;
  const digest = image.match(/@sha256:([a-f0-9]{64})$/)?.[1];
  return <code className={styles.image} title={image} aria-label={`${t('runtimeImages.picker.label')}: ${image}`}>
    {compact && digest ? `sha256:${digest.slice(0, 12)}` : image}
  </code>;
}
