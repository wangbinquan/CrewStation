import type { ProjectResourceSnapshot } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { metricLabel, metricLimit, metricUnit, numberText } from '../model/workspace';
import styles from './ResourceCenter.module.css';

export function DeploymentQuota({ snapshot, onOpen }: { snapshot: ProjectResourceSnapshot; onOpen: () => void }) {
  const t = useT(), quota = snapshot.nodes.find((node) => node.resourceType === 'namespace-quota');
  return <div className={styles.boundary}>
    <div className={styles.toolbar}><strong>{snapshot.namespace}</strong><Button size="small" onClick={onOpen}>{t('resourceCenter.deployment.namespaceQuota')}</Button></div>
    {quota ? <div className={styles.quotaSummary}>{quota.metrics.map((metric) => <div key={`${metric.scopeId}:${metric.key}`}><small>{metricLabel(metric, t)}</small><strong>{numberText(metric.used)} / {metricLimit(metric, t)}</strong>{metric.requestedLimit !== null ? <small>{t('resourceCenter.requestedLimit')} · {numberText(metric.requestedLimit)} {metricUnit(metric.unit, t)}</small> : null}</div>)}</div> : <p>{t('resourceCenter.notObserved')}</p>}
  </div>;
}
