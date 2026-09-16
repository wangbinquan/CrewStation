import { BEFORE_START_LIMITS } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { DataTable } from '../../../../shared/ui/DataTable';
import type { DraftErrors, StepDraft } from '../../model/runtimeDraft';
import styles from './RuntimeEditor.module.css';

export interface RuntimeStepListProps {
  readonly steps: readonly StepDraft[];
  readonly selected: number | null;
  readonly errors: DraftErrors;
  readonly disabled: boolean;
  readonly onSelect: (index: number) => void;
  readonly onAdd: (kind: StepDraft['kind']) => void;
  readonly onMove: (index: number, delta: -1 | 1) => void;
  readonly onDuplicate: (index: number) => void;
  readonly onRemove: (index: number) => void;
}

/** 步骤表：顺序即执行顺序；行内按钮改序、复制、删除，选中行在右侧编辑。 */
export function RuntimeStepList({ steps, selected, errors, disabled, onSelect, onAdd, onMove, onDuplicate, onRemove }: RuntimeStepListProps): ReactElement {
  const t = useT();
  const full = steps.length >= BEFORE_START_LIMITS.maxSteps;
  return (
    <div>
      <div className={styles.toolbar}>
        <Button disabled={disabled || full} onClick={() => onAdd('file')}>{t('admin.runtime.step.addFile')}</Button>
        <Button disabled={disabled || full} onClick={() => onAdd('script')}>{t('admin.runtime.step.addScript')}</Button>
      </div>
      {steps.length === 0 ? <p className={styles.hint}>{t('admin.runtime.step.empty')}</p> : (
        <DataTable columns={['order', 'kind', 'name', 'target', 'actions'].map((column) => t(`admin.runtime.step.${column === 'actions' ? 'select' : column}`))}>
          {steps.map((step, index) => {
            const invalid = Object.keys(errors).some((key) => key.startsWith(`steps.${index}.`));
            return (
              <tr key={step.stepId} className={index === selected ? styles.selected : undefined} aria-selected={index === selected}>
                <td>{index + 1}</td>
                <td>{t(`admin.runtime.step.kind.${step.kind}`)}</td>
                <td>{step.name === '' ? <em>{step.stepId}</em> : step.name} {invalid ? <Badge tone="danger">!</Badge> : null}</td>
                <td><code>{step.kind === 'file' ? step.pathTemplate : t(`admin.runtime.step.language.${step.language}`)}</code></td>
                <td>
                  <div className={styles.rowActions}>
                    <Button variant={index === selected ? 'secondary' : 'ghost'} aria-pressed={index === selected} onClick={() => onSelect(index)}>{t('admin.runtime.step.select')}</Button>
                    <Button variant="ghost" disabled={disabled || index === 0} aria-label={`${t('admin.runtime.step.up')} ${step.stepId}`} onClick={() => onMove(index, -1)}>↑</Button>
                    <Button variant="ghost" disabled={disabled || index === steps.length - 1} aria-label={`${t('admin.runtime.step.down')} ${step.stepId}`} onClick={() => onMove(index, 1)}>↓</Button>
                    <Button variant="ghost" disabled={disabled || full} onClick={() => onDuplicate(index)}>{t('admin.runtime.step.duplicate')}</Button>
                    <Button variant="ghost" disabled={disabled} onClick={() => onRemove(index)}>{t('admin.runtime.step.remove')}</Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </div>
  );
}
