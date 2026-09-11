import type { BranchDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { behindText } from '../model/branchChoice';
import styles from './BranchSelect.module.css';

export interface BranchSelectProps {
  readonly id: string;
  readonly branches: readonly BranchDto[];
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (branch: string) => void;
}

/** 分支下拉：每项标出落后 preview 与 prod 槽的提交数，选分支时不必再去发布页对照。 */
export function BranchSelect({ id, branches, value, disabled = false, onChange }: BranchSelectProps): ReactElement {
  const t = useT();
  return (
    <select id={id} className={styles.select} value={value} disabled={disabled || branches.length === 0} onChange={(event) => onChange(event.target.value)}>
      {branches.length === 0 ? <option value="">{t('devSession.branch.none')}</option> : null}
      {branches.map((branch) => (
        <option key={branch.name} value={branch.name}>
          {t('devSession.branch.option', {
            name: branch.name,
            preview: behindText(branch.behindPreview),
            prod: behindText(branch.behindProd),
          })}
        </option>
      ))}
    </select>
  );
}
