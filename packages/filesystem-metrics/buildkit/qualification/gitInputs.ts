import { createHash } from 'node:crypto';
import { join } from 'node:path';

export interface GitInputExpectation { repositoryIdentity: string; commit: string; tree?: readonly { path: string; mode: '100644' | '100755'; blob: string }[] }
export interface GitInputFile { path: string; kind: 'file' | 'directory'; gitBlob?: string; executable?: boolean }
export const gitRepositoryIdentity = (raw: string) => {
  const url = new URL(raw); if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) throw Error('Native Git input repository is unsupported');
  url.username = ''; url.password = ''; url.pathname = url.pathname.replace(/\.git\/?$/, '').replace(/\/$/, '');
  return createHash('sha256').update(url.href).digest('hex');
};
async function git(root: string, args: string[], signal: AbortSignal) {
  signal.throwIfAborted();
  const child = Bun.spawn(['git', '--no-optional-locks', '--git-dir=' + join(root, '.git'), ...args], { stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' } });
  const abort = () => child.kill(); signal.addEventListener('abort', abort, { once: true });
  try {
    const [bytes, _errors, code] = await Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).arrayBuffer(), child.exited]);
    signal.throwIfAborted(); if (code || bytes.byteLength > 8_388_608) throw Error('Original native Git input did not reach a bounded complete EOF');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally { signal.removeEventListener('abort', abort); }
}
/** Git plumbing only; no worktree checkout, hooks, filters, external diffs,
 * status refresh or lock writes. Full native bytes match every original blob,
 * with no untracked or ignored project files hidden from qualification. */
export async function qualifyNativeGitInput(root: string, files: readonly GitInputFile[], expected: readonly GitInputExpectation[], signal: AbortSignal) {
  if (!expected.length) return [];
  if (!files.some(row => row.kind === 'directory' && row.path === '.git')) {
    // BuildKit applies .dockerignore before storing local context and commonly
    // excludes .git. The independent original SCM supplies the complete tree;
    // every native byte and executable mode still has to match that commit.
    return expected.filter(row => row.tree && matches(files, row.tree)).map(row => ({ repositoryIdentity: row.repositoryIdentity, commit: row.commit,
      identity: createHash('sha256').update(JSON.stringify({ files, original: row })).digest('hex') }));
  }
  const commit = (await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'], signal)).trim(), repositoryIdentity = gitRepositoryIdentity((await git(root, ['config', '--local', '--get', 'remote.origin.url'], signal)).trim());
  const matched = expected.filter(row => row.commit === commit && row.repositoryIdentity === repositoryIdentity); if (!matched.length) return [];
  const raw = await git(root, ['ls-tree', '-r', '-z', '--full-tree', commit], signal), records = raw.split('\0');
  if (records.pop() !== '') throw Error('Original native Git tree did not reach EOF');
  const tracked = records.map(row => { const value = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/.exec(row);
    if (!value) throw Error('Native Git input contains unsupported original tree entries'); return { path: value[3]!, mode: value[1]!, blob: value[2]! }; });
  if (!matches(files, tracked)) return [];
  return matched.map(row => ({ repositoryIdentity: row.repositoryIdentity, commit: row.commit, identity: createHash('sha256').update(JSON.stringify({ rootFiles: files, repositoryIdentity, commit, tracked })).digest('hex') }));
}
function matches(files: readonly GitInputFile[], tracked: readonly { path: string; mode: string; blob: string }[]) {
  const actual = files.filter(row => row.kind === 'file' && !row.path.startsWith('.git/'));
  return !!actual.length && new Set(tracked.map(row => row.path)).size === tracked.length && actual.length === tracked.length
    && !tracked.some(row => !row.path || row.path.split('/').some(p => !p || p === '.' || p === '..') || row.path.startsWith('.git/') || !/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(row.blob))
    && !actual.some(row => !tracked.some(before => before.path === row.path && before.blob === row.gitBlob && before.mode === (row.executable ? '100755' : '100644')))
    && !files.some(row => row.kind === 'directory' && row.path !== '.git' && !row.path.startsWith('.git/') && !tracked.some(before => before.path.startsWith(row.path + '/')));
}
