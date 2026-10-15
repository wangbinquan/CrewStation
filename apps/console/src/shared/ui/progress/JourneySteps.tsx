import styles from './JourneySteps.module.css';

/** 页面级旅程导航；current 从服务端事实推导，不把未读到的阶段视为已完成。 */
export function JourneySteps({ labels, current, label }: { readonly labels: readonly string[]; readonly current: number; readonly label: string }) {
  return <ol className={styles.steps} aria-label={label}>{labels.map((name, index) => <li key={name} data-state={index < current ? 'done' : index === current ? 'current' : 'pending'} aria-current={index === current ? 'step' : undefined}>
    <span aria-hidden="true">{index < current ? '✓' : index + 1}</span><strong>{name}</strong>
  </li>)}</ol>;
}
