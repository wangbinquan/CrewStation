export const GITHUB_EVENT_HEADER = 'x-github-event';
export const PRODUCER_NAME = 'github';
const PR_ACTIONS: Readonly<Record<string, string>> = {
  opened: 'open', reopened: 'reopen', synchronize: 'update', edited: 'update',
  ready_for_review: 'update', converted_to_draft: 'update',
};
const TYPES = ['push', 'tag-push', 'pull-request.open', 'pull-request.reopen', 'pull-request.update',
  'pull-request.close', 'pull-request.merge', 'pull-request.comment', 'issue.comment',
  'pull-request.review-comment', 'issue.labeled', 'workflow-run.success', 'workflow-run.failure', 'workflow-run.timed-out'];
export const allEventTypes = (): string[] => TYPES.map((type) => `github.${type}`);
export type EventTypeResult = { ok: true; eventType: string } | { ok: false; invalid?: boolean; reason: string };
export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function mapEventType(hook: string | null, payload: unknown): EventTypeResult {
  const root = record(payload) ?? {};
  const type = selectType(hook, root);
  if (!type) return { ok: false, reason: 'Unsupported event or action' };
  if (!validPayload(hook, root)) return { ok: false, invalid: true, reason: 'Missing repository or event object identity' };
  return { ok: true, eventType: `github.${type}` };
}

function selectType(hook: string | null, root: Record<string, unknown>): string | undefined {
  const action = typeof root.action === 'string' ? root.action : '';
  if (hook === 'push') return typeof root.ref === 'string' && root.ref.startsWith('refs/tags/') ? 'tag-push' : 'push';
  if (hook === 'pull_request') {
    if (action === 'closed') return record(root.pull_request)?.merged === true ? 'pull-request.merge' : 'pull-request.close';
    const suffix = PR_ACTIONS[action];
    return suffix ? `pull-request.${suffix}` : undefined;
  }
  if (hook === 'issue_comment' && action === 'created') return record(root.issue)?.pull_request ? 'pull-request.comment' : 'issue.comment';
  if (hook === 'pull_request_review_comment' && action === 'created') return 'pull-request.review-comment';
  if (hook === 'issues' && action === 'labeled') return 'issue.labeled';
  if (hook === 'workflow_run' && action === 'completed') {
    const conclusion = record(root.workflow_run)?.conclusion;
    if (conclusion === 'success' || conclusion === 'failure' || conclusion === 'timed_out') return `workflow-run.${conclusion.replace('_', '-')}`;
  }
  return undefined;
}

function validPayload(hook: string | null, root: Record<string, unknown>): boolean {
  const hasId = (value: unknown): boolean => { const id = record(value)?.id; return typeof id === 'number' && Number.isSafeInteger(id) && id > 0; };
  if (!hasId(root.repository)) return false;
  if (hook === 'push') return typeof root.ref === 'string' && /^refs\/(heads|tags)\/.+/.test(root.ref) && typeof root.after === 'string';
  if (hook === 'pull_request') return hasId(root.pull_request) && (root.action !== 'closed' || typeof record(root.pull_request)?.merged === 'boolean');
  if (hook === 'issue_comment') return hasId(root.issue) && hasId(root.comment) && typeof record(root.comment)?.body === 'string';
  if (hook === 'pull_request_review_comment') return hasId(root.pull_request) && hasId(root.comment) && typeof record(root.comment)?.body === 'string';
  if (hook === 'issues') return hasId(root.issue) && hasId(root.label);
  return hasId(root.workflow_run);
}
