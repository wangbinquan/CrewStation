import type { CSSProperties, ReactElement } from 'react';
import styles from './Brand.module.css';

/** 有字标时图形为装饰；仅显示图形时保留应用名称。品牌色不表示运行状态。 */
export function Brand({ name = 'CrewStation', size = 28, wordmark = true, monochrome = false }: {
  readonly name?: string; readonly size?: number; readonly wordmark?: boolean; readonly monochrome?: boolean;
}): ReactElement {
  const style: CSSProperties = { width: size, height: size };
  return <span className={styles.brand}>
    {monochrome ? <span className={styles.mono} style={style} role={wordmark ? undefined : 'img'} aria-label={wordmark ? undefined : name} aria-hidden={wordmark ? true : undefined} />
      : <img src="/brand/crewstation-mark.svg" style={style} width={size} height={size} alt={wordmark ? '' : name} />}
    {wordmark ? <span className={styles.name}>{name}</span> : null}
  </span>;
}
