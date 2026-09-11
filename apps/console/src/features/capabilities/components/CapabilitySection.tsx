import type { ReactElement, ReactNode } from 'react';
import { Card } from '../../../shared/ui/Card';
import styles from './CapabilitySection.module.css';

export interface CapabilitySectionProps {
  readonly title: string;
  /** 一句话说明这一段为什么存在，读页面的人不必回去翻设计文档。 */
  readonly note?: string;
  readonly children: ReactNode;
}

export function CapabilitySection({ title, note, children }: CapabilitySectionProps): ReactElement {
  return (
    <Card title={title}>
      {note !== undefined ? <p className={styles.note}>{note}</p> : null}
      {children}
    </Card>
  );
}
