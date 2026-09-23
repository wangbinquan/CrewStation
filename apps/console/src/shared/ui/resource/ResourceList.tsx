import type { ReactElement, ReactNode } from 'react';
import styles from './ResourceList.module.css';

/**
 * 紧凑资源列表（开发页「可使用资源」）：每条两行——首行是写代码要用的那个值（路径、事件类型、变量名），
 * 次行是来源与说明；右侧放状态或动作，细节在行下原地展开。只按宽度折行，任何宽度都不出横向滚动条。
 */
export function ResourceList({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement {
  return <div className={styles.list} role="group" aria-label={label}>{children}</div>;
}

/** 分组：分割线上写组名与条数；组里没有条目时仍保留分割线并写明为空。`plain` 时内容不是 `ResourceRow`，不包列表。 */
export function ResourceGroup({ title, count, note, empty, plain = false, children }: { readonly title: ReactNode; readonly count?: number; readonly note?: ReactNode; readonly empty?: ReactNode; readonly plain?: boolean; readonly children?: ReactNode }): ReactElement {
  return <section className={styles.group}>
    <h3 className={styles.divider}><span>{title}</span>{count !== undefined ? <span className={styles.count}>{count}</span> : null}</h3>
    {note ? <p className={styles.note}>{note}</p> : null}
    {count === 0 && empty ? <p className={styles.empty}>{empty}</p> : plain ? children : <ul className={styles.rows}>{children}</ul>}
  </section>;
}

export interface ResourceRowProps {
  /** 首行最前面的小标签，如 HTTP 方法。 */
  readonly lead?: ReactNode;
  readonly title: ReactNode;
  readonly meta?: ReactNode;
  readonly trailing?: ReactNode;
  readonly current?: boolean;
  /** 给了就把首行做成按钮（选中或展开）。 */
  readonly onActivate?: () => void;
  readonly activateLabel?: string;
  readonly expanded?: boolean;
  /** 行下原地展开的内容。 */
  readonly children?: ReactNode;
}

export function ResourceRow({ lead, title, meta, trailing, current, onActivate, activateLabel, expanded, children }: ResourceRowProps): ReactElement {
  const head = <>{lead}<span className={styles.title}>{title}</span></>;
  return <li className={styles.row} aria-current={current ? true : undefined}>
    <div className={styles.line}>
      <div className={styles.main}>
        {onActivate ? <button type="button" className={styles.head} aria-expanded={expanded} title={activateLabel} onClick={onActivate}>{head}</button> : <div className={styles.head}>{head}</div>}
        {meta ? <div className={styles.meta}>{meta}</div> : null}
      </div>
      {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
    </div>
    {children ? <div className={styles.expansion}>{children}</div> : null}
  </li>;
}

/** HTTP 方法：等宽、按语义着色，读路径时一眼分清读写。 */
export function MethodTag({ method }: { readonly method: string }): ReactElement {
  const tone = method === 'GET' || method === 'HEAD' ? styles.read : method === 'DELETE' ? styles.remove : styles.write;
  return <span className={`${styles.method} ${tone}`}>{method}</span>;
}

/** 路径与事件类型只在「/」「.」「-」后折行，不把一个词拆成两半。 */
export function BreakableText({ text }: { readonly text: string }): ReactElement {
  const parts = text.split(/(?<=[/.-])/u);
  return <>{parts.map((part, index) => <span key={index}>{part}{index < parts.length - 1 ? <wbr /> : null}</span>)}</>;
}

/** 次行里用「·」隔开的几段，空的自动略去。 */
export function MetaLine({ parts }: { readonly parts: readonly ReactNode[] }): ReactElement {
  const shown = parts.filter((part) => part !== undefined && part !== null && part !== '');
  return <>{shown.map((part, index) => <span key={index} className={styles.metaPart}>{part}</span>)}</>;
}
