import type { ComparisonFile } from '@crewstation/contracts';
import type { Translate } from '../../../shared/lib/useT';

const changes: Readonly<Record<string, string>> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'typeChanged' };

function describeStatus(status: string, t: Translate): string {
  if (status === 'untracked' || status === '??') return t('devSession.compare.untracked');
  if (status === 'conflict') return t('devSession.compare.change.conflict');
  if (/^[AMDRCT](?:\d+)?$/.test(status)) return t(`devSession.compare.change.${changes[status[0]!]}`);
  // porcelain v2 uses X for the index and Y for the worktree; a dot means unchanged.
  if (/^[. AMDRCT]{2}$/.test(status)) {
    const parts = [...status].flatMap((code, index) => changes[code]
      ? [t(`devSession.compare.${index === 0 ? 'stagedChange' : 'unstagedChange'}`, { change: t(`devSession.compare.change.${changes[code]}`) })] : []);
    if (parts.length) return parts.join(' · ');
  }
  return status;
}

export function comparisonFileStatus(file: Pick<ComparisonFile, 'status' | 'untracked'>, t: Translate): string {
  const label = describeStatus(file.status, t);
  return file.untracked && file.status !== 'untracked' && file.status !== '??'
    ? `${label} · ${t('devSession.compare.untracked')}` : label;
}
