import type { LogEntryDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import styles from './LogLevelBadge.module.css';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'log';

const ERROR_WORDS = /\b(ERROR|ERR|FATAL|PANIC)\b/;
const WARN_WORDS = /\b(WARN|WARNING)\b/;
const DEBUG_WORDS = /\b(DEBUG|TRACE)\b/;
const INFO_WORDS = /\bINFO\b/;

/**
 * 先看行首的级别词，认不出时按已知 stdout／stderr 兜底；混合输出显示中性的 LOG。
 * 这是显示层的推断，不代表平台承诺的日志级别。
 */
export function logLevelOf(entry: LogEntryDto): LogLevel {
  const head = entry.message.slice(0, 80).toUpperCase();
  if (ERROR_WORDS.test(head)) return 'error';
  if (WARN_WORDS.test(head)) return 'warn';
  if (DEBUG_WORDS.test(head)) return 'debug';
  if (INFO_WORDS.test(head)) return 'info';
  if (entry.stream === 'combined') return 'log';
  return entry.stream === 'stderr' ? 'warn' : 'info';
}

export function LogLevelBadge({ level }: { readonly level: LogLevel }): ReactElement {
  const t = useT();
  return <span className={[styles.level, styles[level]].join(' ')}>{t(`logs.level.${level}`)}</span>;
}
