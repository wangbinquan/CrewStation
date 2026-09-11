import type { BranchDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import type { Translate } from '../../../shared/lib/useT';

export interface BranchSelectProps {
  readonly branches: readonly BranchDto[];
  readonly value: string;
  readonly onChange: (branch: string) => void;
}

/** 选项里直接写出该分支落后两个槽多少个提交，避免选到比线上还旧的分支。 */
function branchLabel(branch: BranchDto, t: Translate): string {
  const unknown = t('release.publish.branchLagUnknown');
  const lag = t('release.publish.branchLag', {
    preview: branch.behindPreview === null ? unknown : branch.behindPreview,
    prod: branch.behindProd === null ? unknown : branch.behindProd,
  });
  return branch.isDefault ? `${branch.name} · ${t('release.publish.branchDefault')} · ${lag}` : `${branch.name} · ${lag}`;
}

export function BranchSelect({ branches, value, onChange }: BranchSelectProps): ReactElement {
  const t = useT();
  return (
    <select value={value} required onChange={(event) => onChange(event.target.value)} disabled={branches.length === 0}>
      {branches.length === 0 ? <option value="">{t('release.publish.branchEmpty')}</option> : null}
      {branches.map((branch) => (
        <option key={branch.name} value={branch.name}>
          {branchLabel(branch, t)}
        </option>
      ))}
    </select>
  );
}
