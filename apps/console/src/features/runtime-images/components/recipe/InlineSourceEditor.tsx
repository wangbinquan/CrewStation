import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RuntimeImageSourceSchema } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { FormField } from '../../../../shared/ui/FormField';
import { Button } from '../../../../shared/ui/Button';
import { buildFileSize, encodeBuildFile } from '../../model/inlineDraft';
import { RecipeGuide } from './RecipeGuide';
import styles from '../RuntimeImages.module.css';

interface FileValue { path: string; contentBase64: string; executable: boolean }
export function InlineSourceEditor({ source, onChange, onPendingChange }: { readonly source: Record<string, unknown>; readonly onChange: (change: Record<string, unknown>) => void; readonly onPendingChange?: (pending: boolean) => void }) {
  const t = useT(), [error, setError] = useState(''), [loading, setLoading] = useState(false), generation = useRef(0);
  const latest = useRef(source), callbacks = useRef({ onChange, onPendingChange });
  useLayoutEffect(() => { latest.current = source; callbacks.current = { onChange, onPendingChange }; }, [source, onChange, onPendingChange]);
  useEffect(() => () => { generation.current++; callbacks.current.onPendingChange?.(false); }, []);
  const validFiles = source.files === undefined || Array.isArray(source.files) && source.files.every((file) => file && typeof file.path === 'string' && buildFileSize(file.contentBase64) !== undefined);
  const files = validFiles && Array.isArray(source.files) ? source.files as FileValue[] : [];
  const upload = async (selected: readonly File[]) => {
    const token = ++generation.current;
    if (!validFiles) { setError(t('images.invalidBuildFiles')); return; }
    if (selected.length + files.length > 32 || selected.reduce((n, f) => n + f.size, 0) + files.reduce((n, f) => n + buildFileSize(f.contentBase64)!, 0) > 512 * 1024) { setError(t('images.inlineLimit')); return; }
    setLoading(true); callbacks.current.onPendingChange?.(true); setError('');
    try {
      const added = await Promise.all(selected.map(encodeBuildFile));
      if (token !== generation.current) return;
      const current = latest.current, next = [...(Array.isArray(current.files) ? current.files : []), ...added];
      const checked = RuntimeImageSourceSchema.safeParse({ ...current, files: next });
      if (!checked.success) { setError(checked.error.issues.map((i) => i.message).join('；')); return; }
      callbacks.current.onChange({ files: next });
    } catch { if (token === generation.current) setError(t('images.fileReadFailed')); }
    finally { if (token === generation.current) { setLoading(false); callbacks.current.onPendingChange?.(false); } }
  };
  return <div className={styles.stack}>
    <p className={styles.note}>{t('images.inlineHint')}</p>
    <FormField label={t('images.dockerfileContent')} hint={t('images.dockerfileLimit')}><textarea rows={12} spellCheck={false} value={String(source.dockerfileContent ?? '')} onChange={(event) => onChange({ dockerfileContent: event.target.value })} /></FormField>
    <FormField label={t('images.buildFiles')} hint={t('images.inlineLimit')}><input type="file" multiple disabled={loading} onChange={(event) => { const selected = [...(event.target.files ?? [])]; event.target.value = ''; void upload(selected); }} /></FormField>
    {error ? <p role="alert">{error}</p> : null}
    {!validFiles ? <p role="alert">{t('images.invalidBuildFiles')}</p> : null}
    {files.map((file, index) => <div key={index} className={styles.row}>
      <FormField label={t('images.filePath')}><input value={file.path} onChange={(event) => onChange({ files: files.map((item, i) => i === index ? { ...item, path: event.target.value } : item) })} /></FormField>
      <span>{buildFileSize(file.contentBase64)} B</span>
      <label><input type="checkbox" checked={!!file.executable} onChange={(event) => onChange({ files: files.map((item, i) => i === index ? { ...item, executable: event.target.checked } : item) })} /> {t('images.fileExecutable')}</label>
      <Button size="small" onClick={() => onChange({ files: files.filter((_, i) => i !== index) })}>{t('images.removeFile')}</Button>
    </div>)}
    <RecipeGuide service={source.usage === 'service'} inline />
  </div>;
}
