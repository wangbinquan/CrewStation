import { useRef } from 'react';
import type { ReactElement } from 'react';
import '@xterm/xterm/css/xterm.css';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { useTerminalPane } from '../../hooks/useTerminalPane';
import type { TaskStreamChannel } from '../../hooks/useTaskStream';
import { Pane } from '../Pane';
import { PaneNotice } from '../PaneNotice';
import styles from './TerminalPane.module.css';

export interface TerminalPaneProps {
  readonly channel: TaskStreamChannel;
  readonly onActivity: () => void;
}

/** 开发容器里的 Web 终端：按容器尺寸自适应 cols／rows，输入输出都走同一条任务流。 */
export function TerminalPane({ channel, onActivity }: TerminalPaneProps): ReactElement {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminal = useTerminalPane(containerRef, channel, onActivity);
  return (
    <Pane
      title={t('devSession.terminal.title')}
      className={styles.pane}
      flush
      extra={<Button onClick={terminal.reopen}>{t('devSession.terminal.reopen')}</Button>}
      footer={terminal.error === undefined ? undefined : <PaneNotice tone="warning">{terminal.error}</PaneNotice>}
    >
      <div className={styles.surface} ref={containerRef} />
    </Pane>
  );
}
