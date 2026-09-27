import type { RuntimeImageRevisionDto } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import styles from './RuntimeImages.module.css';

export function RecipeSummary({ revision }: { readonly revision: RuntimeImageRevisionDto }) {
  const t = useT(), source = revision.source;
  return <div className={styles.stack}><h4>{t('images.revision')} {revision.revision}</h4>
    <p>{t(`images.usage.${source.usage}`)} · {source.architecture}</p>
    {source.kind === 'source' ? <dl>
      <dt>{t('images.gitRef')}</dt><dd className={styles.identity}>{source.ref}</dd>
      <dt>{t('images.fixedCommit')}</dt><dd className={styles.identity}>{revision.commitSha}</dd>
      <dt>{t('images.context')}</dt><dd>{source.context}</dd>
      <dt>{t('images.dockerfile')}</dt><dd>{source.dockerfile}</dd>
    </dl> : <p className={styles.identity}>{source.reference}</p>}
    {source.usage !== 'service' ? <p>{t('images.recipeChecks', { steps: revision.initializer.steps.length, tools: revision.tools.length })}</p> : null}
  </div>;
}
