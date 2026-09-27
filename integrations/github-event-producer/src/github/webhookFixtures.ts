// Protocol examples for producer regression tests; no live repository credentials.
const repository = { id: 1 };
const pr = { id: 2, merged: false };
const comment = { id: 3, body: '你好 👋' };
const issue = { id: 4 };
const row = (hook: string, type: string, payload: Record<string, unknown>) => ({ hook, type: `github.${type}`, payload: { repository, ...payload } });
export const cases = [
  row('push', 'push', { ref: 'refs/heads/main', after: 'a'.repeat(40) }),
  row('push', 'tag-push', { ref: 'refs/tags/v1', after: 'a'.repeat(40) }),
  ...[['opened', 'open'], ['reopened', 'reopen'], ['synchronize', 'update'], ['edited', 'update'], ['ready_for_review', 'update'], ['converted_to_draft', 'update'], ['closed', 'close']].map(([action, suffix]) => row('pull_request', `pull-request.${suffix}`, { action, pull_request: pr })),
  row('pull_request', 'pull-request.merge', { action: 'closed', pull_request: { ...pr, merged: true } }),
  row('issue_comment', 'pull-request.comment', { action: 'created', issue: { ...issue, pull_request: { url: 'https://api.github.com/repos/o/r/pulls/1' } }, comment }),
  row('issue_comment', 'issue.comment', { action: 'created', issue, comment }),
  row('pull_request_review_comment', 'pull-request.review-comment', { action: 'created', pull_request: pr, comment: { ...comment, path: 'src/main.ts', line: 12 } }),
  row('issues', 'issue.labeled', { action: 'labeled', issue, label: { id: 5, name: 'agent' } }),
  ...['success', 'failure', 'timed_out'].map((conclusion) => row('workflow_run', `workflow-run.${conclusion.replace('_', '-')}`, { action: 'completed', workflow_run: { id: 6, run_attempt: 1, conclusion } })),
];

