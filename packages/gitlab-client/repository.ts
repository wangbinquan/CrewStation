import type { CreateTagInput, GitLabBranch, GitLabCommit, GitLabCompareResult, GitLabProjectRef, GitLabTag, GitLabTreeEntry, RepositoryTreeOptions } from './models';
import type { Transport } from './transport';
import { encodeRef } from './transport';

interface RawCommit {
  id: string; short_id: string; title: string; message: string; author_name: string; author_email: string;
  authored_date: string; committed_date: string; parent_ids?: string[];
}
interface RawBranch { name: string; commit: RawCommit; default: boolean; protected: boolean; merged: boolean }
interface RawTag { name: string; message: string | null; target: string; commit: RawCommit; protected?: boolean }
interface RawCompare { commits: RawCommit[]; compare_same_ref: boolean; compare_timeout: boolean }

export function toCommit(raw: RawCommit): GitLabCommit {
  return {
    id: raw.id, shortId: raw.short_id, title: raw.title, message: raw.message, authorName: raw.author_name,
    authorEmail: raw.author_email, authoredDate: raw.authored_date, committedDate: raw.committed_date, parentIds: raw.parent_ids ?? [],
  };
}

const toBranch = (raw: RawBranch): GitLabBranch => ({ name: raw.name, commit: toCommit(raw.commit), default: raw.default, protected: raw.protected, merged: raw.merged });
const toTag = (raw: RawTag): GitLabTag => ({ name: raw.name, message: raw.message ?? null, target: raw.target, commit: toCommit(raw.commit), protected: raw.protected ?? false });

export function repositoryOperations(transport: Transport) {
  const repo = (id: GitLabProjectRef): string => `/projects/${encodeRef(id)}/repository`;
  return {
    listBranches: async (id: GitLabProjectRef): Promise<GitLabBranch[]> => (await transport.requestAll<RawBranch>(`${repo(id)}/branches`)).map(toBranch),
    getBranch: async (id: GitLabProjectRef, name: string): Promise<GitLabBranch> => toBranch(await transport.request<RawBranch>('GET', `${repo(id)}/branches/${encodeURIComponent(name)}`)),
    listTags: async (id: GitLabProjectRef): Promise<GitLabTag[]> => (await transport.requestAll<RawTag>(`${repo(id)}/tags`)).map(toTag),
    createTag: async (id: GitLabProjectRef, input: CreateTagInput): Promise<GitLabTag> => toTag(await transport.request<RawTag>('POST', `${repo(id)}/tags`, {
      body: { tag_name: input.name, ref: input.ref, ...(input.message ? { message: input.message } : {}) },
    })),
    /** `from` 落后 `to` 的提交：GitLab 返回 `to` 可达而 `from` 不可达的提交列表。 */
    compare: async (id: GitLabProjectRef, from: string, to: string): Promise<GitLabCompareResult> => {
      const raw = await transport.request<RawCompare>('GET', `${repo(id)}/compare`, { query: { from, to, straight: false } });
      const commits = (raw.commits ?? []).map(toCommit);
      return { commitCount: commits.length, commits, compareSameRef: raw.compare_same_ref ?? false, compareTimeout: raw.compare_timeout ?? false };
    },
    getCommit: async (id: GitLabProjectRef, sha: string): Promise<GitLabCommit> => toCommit(await transport.request<RawCommit>('GET', `${repo(id)}/commits/${encodeURIComponent(sha)}`)),
    getRepositoryTree: (id: GitLabProjectRef, path: string, options: RepositoryTreeOptions = {}): Promise<GitLabTreeEntry[]> =>
      transport.requestAll<GitLabTreeEntry>(`${repo(id)}/tree`, { path, ref: options.ref, recursive: options.recursive }),
  };
}
