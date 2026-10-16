import { useRef, useState } from 'react';
import type { SendBotMessageRequest } from '@crewstation/contracts';
import { SendBotMessageRequestSchema } from '@crewstation/contracts';
import { errorMessage, isApiClientError } from '../../../../shared/api/useApi';
import type { ContinuousBotHandle } from './useContinuousBot';

export interface BotOptions { compute?: SendBotMessageRequest['compute']; computeName?: string; runtimeImageVersionId?: string }
interface Draft { text: string; options?: BotOptions; pending?: SendBotMessageRequest; error?: string }
function read(key: string): Draft {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? '{}') as { text?: unknown; pending?: unknown; options?: BotOptions };
    return { options: value.options, text: typeof value.text === 'string' ? value.text.slice(0, 200_000) : '', ...(value.pending ? { pending: SendBotMessageRequestSchema.parse(value.pending) } : {}) };
  } catch { return { text: '' }; }
}
/** One default Bot per parent task; the request and original revision survive a browser refresh too. */
export function useBotDraft(scope: string, bot: ContinuousBotHandle, onActivity: () => void) {
  const [draft, setDraft] = useState(() => read(scope)), current = useRef(draft), busy = useRef(false);
  const [persisted, setPersisted] = useState(true);
  const update = (next: Draft) => {
    current.current = next; setDraft(next);
    try { sessionStorage.setItem(scope, JSON.stringify(next)); setPersisted(true); }
    catch { setPersisted(false); }
  };
  const edit = (text: string) => { if (!busy.current && !current.current.pending) update({ text, options: current.current.options }); };
  const send = () => {
    if (busy.current || !current.current.text.trim()) return;
    const input = current.current.pending ?? { requestId: crypto.randomUUID(), expectedRevision: bot.conversation?.revision ?? 0, content: current.current.text.trim(), ...(bot.conversation ? {} : { compute: current.current.options?.compute, runtimeImageVersionId: current.current.options?.runtimeImageVersionId }) };
    busy.current = true; update({ ...current.current, pending: input, error: undefined });
    void bot.send.mutateAsync(input).then(receipt => { if (receipt.state === 'rejected') { update({ text: current.current.text, error: receipt.reason }); return; } update({ text: '' }); onActivity(); }, (error: unknown) => {
      const rejected = isApiClientError(error) && [400, 401, 403, 404, 409, 412].includes(error.status);
      update({ ...current.current, ...(rejected ? { pending: undefined } : {}), error: errorMessage(error) });
    }).finally(() => { busy.current = false; });
  };
  const options = (value: BotOptions) => { if (!busy.current && !current.current.pending) update({ ...current.current, options: value }); };
  return { ...draft, edit, setOptions: options, send, sending: bot.send.isPending, uncertain: !!draft.pending && !bot.send.isPending,
    unsaved: !persisted && (!!draft.text || !!draft.pending || !!draft.options) };
}
