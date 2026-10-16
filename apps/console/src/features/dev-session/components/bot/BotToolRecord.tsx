import { useRef, useState } from 'react';
import type { AgentEvent } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { CopyButton } from '../../../../shared/ui/clipboard/CopyButton';
import { Dialog } from '../../../../shared/ui/dialog/Dialog';
import styles from './BotToolRecord.module.css';

/** 事件来自 JSON 协议；字符串保持原样，其他值按 JSON 展示，不能把 false/0/null 当成缺失。 */
function formatted(value: unknown): string | undefined {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function DetailValue({ label, value, missing }: { readonly label: string; readonly value: string | undefined; readonly missing: string }) {
  return <section className={styles.section} aria-label={label}>
    <div className={styles.heading}><h3>{label}</h3>{value !== undefined ? <CopyButton value={value} /> : null}</div>
    {value !== undefined ? <pre className={styles.value}>{value}</pre> : <p className={styles.missing}>{missing}</p>}
  </section>;
}

export function BotToolRecord({ tool, label }: { readonly tool: NonNullable<AgentEvent['tool']>; readonly label: string }) {
  const t = useT(), [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null);
  const input = formatted(tool.input);
  const command = tool.input && typeof tool.input === 'object' && 'command' in tool.input && typeof tool.input.command === 'string'
    ? tool.input.command : undefined;
  const preview = command ?? input;
  return <>
    <div className={styles.row}><span>{label}</span><code>{tool.name}</code>
      <Button ref={trigger} size="small" aria-label={t('devSession.bot.tool.open', { tool: tool.name })} onClick={() => setOpen(true)}>{t('devSession.bot.tool.details')}</Button>
    </div>
    {preview !== undefined ? <pre className={styles.preview}>{preview.length > 600 ? `${preview.slice(0, 600)}…` : preview}</pre> : null}
    {open ? <Dialog title={t('devSession.bot.tool.title', { tool: tool.name })} size="large" returnFocusTo={trigger} onClose={() => setOpen(false)}>
      {tool.callId ? <p className={styles.identity}>{t('devSession.bot.tool.callId')} <code>{tool.callId}</code></p> : null}
      {command !== undefined ? <DetailValue label={t('devSession.bot.tool.command')} value={command} missing="" /> : null}
      <DetailValue label={t('devSession.bot.tool.input')} value={input} missing={t('devSession.bot.tool.noInput')} />
      <DetailValue label={t('devSession.bot.tool.output')} value={formatted(tool.output)} missing={t('devSession.bot.tool.noOutput')} />
    </Dialog> : null}
  </>;
}
