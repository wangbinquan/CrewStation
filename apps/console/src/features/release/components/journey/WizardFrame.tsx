import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { ButtonLink } from '../../../../shared/ui/navigation/ButtonLink';
import { PROJECT_PATHS } from '../../../../shared/project/projectPaths';
import { useProjectScope } from '../../../../shared/project/ProjectScope';
import type { ReleaseSearch } from '../../../../shared/project/releaseSearch';
import styles from './WizardFrame.module.css';

export const WIZARD_STEPS = ['prepare', 'delivery', 'verify', 'launch', 'complete'] as const;
export function WizardFrame({ step, current, onStep, summary, children, footer, history = false, embedded = false, backSearch = {} }: {
  readonly step: number; readonly current: number; readonly onStep?: (step: number) => void; readonly summary?: ReactNode;
  readonly children: ReactNode; readonly footer: ReactNode; readonly history?: boolean; readonly embedded?: boolean; readonly backSearch?: ReleaseSearch;
}) {
  const t = useT(), { projectId, space } = useProjectScope(), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  return <div className={styles.wizard}>
    {!embedded ? <header className={styles.header}>
      <ButtonLink to={PROJECT_PATHS[space].release} params={{ projectId }} search={backSearch} resetScroll={!backSearch.focus} variant="ghost">{t('release.wizard.back')}</ButtonLink>
      <div><h1>{t(history ? 'release.wizard.historyTitle' : 'release.wizard.title')}</h1><p className={styles.muted}>{t('release.wizard.subtitle')}</p></div>
    </header> : null}
    <nav aria-label={t('release.wizard.steps')}><ol className={styles.steps}>{WIZARD_STEPS.map((name, index) => <li key={name} data-current={index === current}>
      <Button variant="ghost" disabled={!onStep || !history && index > current} aria-current={index === step ? 'step' : undefined} onClick={() => onStep?.(index)}>
        <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span><span>{t(`release.wizard.step.${name}`)}</span>
      </Button>
    </li>)}</ol></nav>
    {summary ? <aside className={styles.summary}>{summary}</aside> : null}
    <section className={styles.content} aria-labelledby="release-wizard-step-heading">
      <h2 ref={heading} tabIndex={-1} id="release-wizard-step-heading">{t(`release.wizard.step.${WIZARD_STEPS[step]}`)}</h2>
      {children}
    </section>
    <div className={styles.footer}>{footer}</div>
  </div>;
}
