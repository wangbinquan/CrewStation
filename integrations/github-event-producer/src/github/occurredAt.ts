import { record } from './eventType';

export function deriveOccurredAt(payload: unknown, now: Date): string {
  const root = record(payload) ?? {};
  for (const name of ['comment', 'pull_request', 'workflow_run', 'issue', 'head_commit']) {
    const object = record(root[name]);
    for (const field of ['updated_at', 'created_at', 'timestamp']) {
      const value = object?.[field];
      if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
    }
  }
  return now.toISOString();
}
