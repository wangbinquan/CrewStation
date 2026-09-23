import type { TraceEventDto } from '@crewstation/contracts';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** 一条事件在回放里的两段文字：它是什么（种类）、说了什么（内容）；出错的条目标红。 */
export interface TraceEventText {
  readonly kind: string;
  readonly detail?: string;
  readonly failed: boolean;
}

const exitText = (code: number | null | undefined, t: Translate) => (code === null || code === undefined ? t('traces.event.exitUnknown') : t('traces.event.exitCode', { code }));

export function describeTraceEvent(event: TraceEventDto, t: Translate): TraceEventText {
  switch (event.kind) {
    case 'agent': {
      const tool = event.tool ? `${event.tool.name}${event.tool.isError ? ` · ${t('traces.event.toolFailed')}` : ''}` : undefined;
      const detail = event.error ?? tool ?? event.text ?? event.status ?? (event.exitCode !== undefined ? exitText(event.exitCode, t) : undefined);
      return { kind: t(`traces.event.agent.${event.type ?? 'status'}`), ...(detail ? { detail } : {}), failed: Boolean(event.error || event.tool?.isError) };
    }
    case 'before-start': {
      const state = event.status ? t(`traces.beforeStart.${event.status}`) : undefined;
      const detail = [event.text, event.error].filter(Boolean).join(' · ');
      return { kind: state ? `${t('traces.event.beforeStart')} · ${state}` : t('traces.event.beforeStart'), ...(detail ? { detail } : {}), failed: event.status === 'failed' };
    }
    case 'activity': {
      // 活动信号的种类由 Runner 上报，平台新增种类时文案可能还没跟上：没有文案就原样显示种类名。
      const key = `traces.activity.${event.status ?? ''}`, label = t(key);
      return { kind: t('traces.event.activity'), ...(event.status ? { detail: label === key ? event.status : label } : {}), failed: event.status === 'turn-failed' };
    }
    case 'terminal-closed':
      return { kind: t('traces.event.terminalClosed'), detail: exitText(event.exitCode, t), failed: typeof event.exitCode === 'number' && event.exitCode !== 0 };
  }
}
