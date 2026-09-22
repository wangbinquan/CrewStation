import type { ReactElement } from 'react';
import { useT } from '../../lib/useT';
import { useDateText } from '../../lib/useDateText';
import type { Topology } from './topologyModel';
import styles from './Topology.module.css';

/** 快照说明行：完整或部分来源失败、观测时间、位置按 UID 固定。 */
export function TopologyObserved({ topology }: { readonly topology: Topology }): ReactElement {
  const t = useT(), date = useDateText();
  return <p className={`${styles.observed}${topology.complete ? '' : ` ${styles.observedPartial}`}`}>
    {topology.complete ? t('topology.observed.complete') : t('topology.observed.partial', { reason: topology.incompleteReason ?? '' })} · {t('topology.observed.at', { time: date(topology.observedAt) })} · {t('topology.observed.stable')}
  </p>;
}
