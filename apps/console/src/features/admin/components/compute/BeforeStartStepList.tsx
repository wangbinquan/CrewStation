import { BEFORE_START_LIMITS } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import type { DraftErrors, StepDraft } from '../../model/stepDraft';
import styles from './ComputeEditor.module.css';

export interface BeforeStartStepListProps {
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

/** 步骤导航：顺序即执行顺序，整块可选；只在当前步骤下展示改序、复制与删除。 */
export function BeforeStartStepList({ steps, selected, errors, disabled, onSelect, onAdd, onMove, onDuplicate, onRemove }: BeforeStartStepListProps): ReactElement {
  const t = useT();
  const full = steps.length >= BEFORE_START_LIMITS.maxSteps;
  return (
    <div className={styles.stepNavigation}>
      <div className={styles.toolbar}>
        <Button disabled={disabled || full} onClick={() => onAdd('file')}>{t('admin.profile.step.addFile')}</Button>
        <Button disabled={disabled || full} onClick={() => onAdd('script')}>{t('admin.profile.step.addScript')}</Button>
      </div>
      {steps.length === 0 ? <p className={styles.hint}>{t('admin.profile.step.empty')}</p> : (
        <ol className={styles.stepList} aria-label={t('admin.profile.section.steps')}>
          {steps.map((step, index) => {
            const invalid = Object.keys(errors).some((key) => key.startsWith(`steps.${index}.`));
            return (
              <li key={step.stepId} className={index === selected ? styles.selected : undefined}>
                <Button className={styles.stepChoice} variant="ghost" aria-pressed={index === selected} disabled={disabled} onClick={() => onSelect(index)}>
                  <span className={styles.stepNumber}>{index + 1}</span>
                  <span className={styles.stepSummary}>
                    <strong>{step.name || step.stepId}</strong>
                    <span className={styles.hint}>{t(`admin.profile.step.kind.${step.kind}`)}{invalid ? <Badge tone="danger">!</Badge> : null}</span>
                    <span className={styles.stepTarget}>{step.kind === 'file' ? step.pathTemplate : t(`admin.profile.step.language.${step.language}`)}</span>
                  </span>
                </Button>
                {index === selected ? (
                  <div className={styles.rowActions}>
                    <Button size="small" disabled={disabled || index === 0} aria-label={`${t('admin.profile.step.up')} ${step.stepId}`} onClick={() => onMove(index, -1)}>{t('admin.profile.step.up')}</Button>
                    <Button size="small" disabled={disabled || index === steps.length - 1} aria-label={`${t('admin.profile.step.down')} ${step.stepId}`} onClick={() => onMove(index, 1)}>{t('admin.profile.step.down')}</Button>
                    <Button size="small" disabled={disabled || full} onClick={() => onDuplicate(index)}>{t('admin.profile.step.duplicate')}</Button>
                    <Button size="small" variant="danger" disabled={disabled} onClick={() => onRemove(index)}>{t('admin.profile.step.remove')}</Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
