import { useState } from 'react';
import { useT } from '../../lib/useT';
import { Button } from '../Button';
import styles from './CopyButton.module.css';

/** 不隐藏完整文本；复制失败时留在原处，用户仍可选择文本手动复制。复制属于随值出现的小工具，一律紧凑描边（2026-09-23 裁定）。 */
export function CopyButton({ value }: { readonly value: string }) {
  const t = useT(), [copied, setCopied] = useState<string>(), [failed, setFailed] = useState(false);
  return <span className={styles.copy}>
    <Button size="small" aria-label={t('ui.copy.value', { value })} onClick={async () => {
      try { await navigator.clipboard.writeText(value); setCopied(value); setFailed(false); }
      catch { setFailed(true); setCopied(undefined); }
    }}>{t(copied === value ? 'ui.copy.done' : 'ui.copy.label')}</Button>
    {failed ? <span role="alert" className={styles.error}>{t('ui.copy.failed')}</span> : null}
  </span>;
}
