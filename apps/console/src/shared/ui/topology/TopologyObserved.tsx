import type { ReactElement } from 'react';
import { useT } from '../../lib/useT';
import { useDateText } from '../../lib/useDateText';
import type { Topology } from './topologyModel';
import styles from './Topology.module.css';

/** 部分来源失败的警示条：图不完整时才出现，写明失败来源；快照完整时不占一行。 */
export function TopologyObserved({ topology }: { readonly topology: Topology }): ReactElement | null {
  const t = useT();
  return topology.complete ? null : <p className={styles.observedPartial}>{t('topology.observed.partial', { reason: topology.incompleteReason ?? '' })}</p>;
}

/** 观测时间标签：叠在图框右上角，精确到秒（快照每 30 秒一换，到分钟时一半的更替看不出来）；快照说明放在悬停提示里。 */
export function TopologyStamp({ topology }: { readonly topology: Topology }): ReactElement {
  const t = useT(), date = useDateText('second');
  return <span className={styles.stamp} title={`${topology.complete ? t('topology.observed.complete') : t('topology.observed.partial', { reason: topology.incompleteReason ?? '' })} · ${t('topology.observed.stable')}`}>{t('topology.observed.at', { time: date(topology.observedAt) })}</span>;
}
