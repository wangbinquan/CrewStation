import type { AgentEvent } from '@crewstation/contracts';

/** Redact known credential values before any business frame reaches the durable journal. */
export async function* redactBusinessEvents(source: AsyncIterable<AgentEvent>, values: readonly string[]): AsyncIterable<AgentEvent> {
  const secrets = [...new Set(values.filter(Boolean))].sort((a, b) => b.length - a.length);
  const redact = (text: string) => secrets.reduce((out, secret) => out.split(secret).join('***'), text);
  const object = (value: unknown): unknown => {
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map(object);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, object(child)]));
    return value;
  };
  let pending = '', sequence = 0, textEvent: AgentEvent | undefined;
  const safe = (event: AgentEvent): AgentEvent => {
    const { raw: _raw, ...rest } = event;
    return { ...rest, seq: ++sequence, ...(event.error ? { error: object(event.error) as AgentEvent['error'] } : {}),
      ...(event.tool ? { tool: object(event.tool) as AgentEvent['tool'] } : {}), ...(event.result?.summary ? { result: { ...event.result, summary: redact(event.result.summary) } } : {}) };
  };
  // Keep only a suffix that could still be the start of a credential split across text frames.
  const split = (text: string): [string, string] => {
    let suffix = 0;
    for (const secret of secrets) for (let size = Math.min(text.length, secret.length - 1); size > suffix; size--) {
      if (text.endsWith(secret.slice(0, size))) { suffix = size; break; }
    }
    return [text.slice(0, text.length - suffix), text.slice(text.length - suffix)];
  };
  for await (const event of source) {
    if (event.type === 'text' && event.text !== undefined) {
      textEvent = event;
      const [ready, tail] = split(redact(pending + event.text)); pending = tail;
      if (ready) yield safe({ ...event, text: ready });
      continue;
    }
    // Preserve a possible prefix across interleaved tool/status frames; output order is retained for text.
    yield safe(event);
  }
  if (pending && textEvent) yield safe({ ...textEvent, text: redact(pending) });
}
