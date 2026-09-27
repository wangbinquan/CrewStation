import { useState } from 'react';
import { RuntimeImageInitializerSchema, RuntimeImageToolCheckSchema } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { FormField } from '../../../../shared/ui/FormField';
import { FormDialog } from '../../../../shared/ui/dialog/FormDialog';
import { DataTable } from '../../../../shared/ui/DataTable';
import styles from '../RuntimeImages.module.css';

type Entry = Record<string, unknown>;
export function RuntimeRecipeFields({ value, onChange }: { readonly value: Entry; readonly onChange: (value: Entry) => void }) {
  const t = useT(), initializer = value.initializer as Entry | undefined;
  const steps = Array.isArray(initializer?.steps) ? initializer.steps as Entry[] : [], tools = Array.isArray(value.tools) ? value.tools as Entry[] : [];
  const [visible, setVisible] = useState(false);
  const [edit, setEdit] = useState<{ kind: 'step' | 'tool'; index?: number; value: Entry }>(), [error, setError] = useState('');
  const change = (kind: 'step' | 'tool', items: Entry[]) => onChange(kind === 'step' ? { ...value, initializer: { ...initializer, steps: items } } : { ...value, tools: items });
  const open = (kind: 'step' | 'tool', index?: number) => {
    setVisible(true); if (edit?.kind === kind && edit.index === index) return;
    setError(''); setEdit({ kind, index, value: index === undefined ? { ...(kind === 'step' ? { id: '' } : { key: '', expected: { kind: 'text', value: '' } }), argv: [''], cwd: '/work', timeoutSeconds: 30 } : { ...(kind === 'step' ? steps : tools)[index] } });
  };
  const submit = () => {
    if (!edit) return;
    const checked = edit.kind === 'tool' ? RuntimeImageToolCheckSchema.safeParse(edit.value) : undefined;
    // Validate the whole list too: duplicate IDs must not survive the local editor.
    const items = [...(edit.kind === 'step' ? steps : tools)]; items[edit.index ?? items.length] = edit.value;
    const result = edit.kind === 'step' ? RuntimeImageInitializerSchema.safeParse({ ...initializer, steps: items }) : checked;
    if (result && 'success' in result && !result.success) { setError(t('images.commandInvalid')); return; }
    if (edit.kind === 'tool' && new Set(items.map((item) => item.key)).size !== items.length) { setError(t('images.commandInvalid')); return; }
    change(edit.kind, items); setEdit(undefined); setVisible(false);
  };
  if ([...steps, ...tools].some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) return <p>{t('images.invalidRecipe')}</p>;
  return <div className={styles.stack}>
    {(['step', 'tool'] as const).map((kind) => <section key={kind} className={styles.stack}>
      <h3>{t(kind === 'step' ? 'images.startupSteps' : 'images.toolChecks')}</h3><p className={styles.note}>{t(kind === 'step' ? 'images.startupHint' : 'images.toolsHint')}</p>
      <div className={styles.row}><Button onClick={() => open(kind)}>{t(kind === 'step' ? 'images.addStep' : 'images.addTool')}</Button></div>
      {(kind === 'step' ? steps : tools).length ? <DataTable columns={[t('images.commandName'), t('images.command'), t('images.actions')]}>
        {(kind === 'step' ? steps : tools).map((entry, index) => <tr key={index}><td>{String(entry.id ?? entry.key)}</td><td><code>{Array.isArray(entry.argv) ? entry.argv.join(' ') : ''}</code></td><td><div className={styles.row}><Button size="small" onClick={() => open(kind, index)}>{t('images.editCommand')}</Button><Button size="small" onClick={() => change(kind, (kind === 'step' ? steps : tools).filter((_, i) => i !== index))}>{t('images.removeDraftItem')}</Button></div></td></tr>)}
      </DataTable> : <p>{t('images.noOptionalCommands')}</p>}
    </section>)}
    <p>{t('images.runtimeAdvancedHint')}</p>
    {visible && edit ? <FormDialog title={t(edit.kind === 'step' ? 'images.startupSteps' : 'images.toolChecks')} submitLabel={t('images.applyDraft')} onSubmit={submit} onClose={() => setVisible(false)} error={error}>
      <FormField label={t('images.commandName')} hint={t('images.commandNameHint')}><input value={String(edit.value.id ?? edit.value.key ?? '')} onChange={(e) => setEdit({ ...edit, value: { ...edit.value, [edit.kind === 'step' ? 'id' : 'key']: e.target.value } })} /></FormField>
      <FormField label={t('images.command')} hint={t('images.commandHint')}><textarea rows={4} placeholder={'python3\n--version'} value={Array.isArray(edit.value.argv) ? edit.value.argv.join('\n') : ''} onChange={(e) => setEdit({ ...edit, value: { ...edit.value, argv: e.target.value.split('\n') } })} /></FormField>
      <FormField label={t('images.workingDirectory')}><input value={String(edit.value.cwd ?? '/work')} onChange={(e) => setEdit({ ...edit, value: { ...edit.value, cwd: e.target.value } })} /></FormField>
      <FormField label={t('images.timeout')}><input type="number" min={1} max={edit.kind === 'step' ? 3600 : 300} value={Number(edit.value.timeoutSeconds ?? 30)} onChange={(e) => setEdit({ ...edit, value: { ...edit.value, timeoutSeconds: Number(e.target.value) } })} /></FormField>
      {edit.kind === 'tool' ? <Expected value={edit.value.expected && typeof edit.value.expected === 'object' ? edit.value.expected as Entry : { kind: 'text', value: '' }} onChange={(expected) => setEdit({ ...edit, value: { ...edit.value, expected } })} /> : null}
      <p>{t('images.draftOnlyHint')}</p>
    </FormDialog> : null}
  </div>;
}

function Expected({ value, onChange }: { readonly value: Entry; readonly onChange: (value: Entry) => void }) {
  const t = useT();
  const [json, setJson] = useState(typeof value.value === 'object' ? JSON.stringify(value.value, null, 2) : value.kind === 'json' ? String(value.value ?? '') : '');
  return <><FormField label={t('images.expectedKind')}><select value={String(value.kind)} onChange={(e) => onChange({ kind: e.target.value, value: e.target.value === 'json' ? {} : '' })}><option value="text">{t('images.expectedText')}</option><option value="sha256">SHA-256</option><option value="json">JSON</option></select></FormField>
    <FormField label={t('images.expectedOutput')} hint={t('images.expectedHint')}><textarea value={value.kind === 'json' ? json : String(value.value)} onChange={(e) => { if (value.kind === 'json') { setJson(e.target.value); try { onChange({ ...value, value: JSON.parse(e.target.value) }); } catch { onChange({ ...value, value: e.target.value }); } } else onChange({ ...value, value: e.target.value }); }} /></FormField></>;
}
