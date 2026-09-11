import type { CreateProjectInput, DeleteProjectOptions, GitLabGroup, GitLabProject, GitLabProjectRef } from './models';
import type { Transport } from './transport';
import { encodeRef } from './transport';

interface RawProject {
  id: number; name: string; path: string; path_with_namespace: string; default_branch: string | null;
  http_url_to_repo: string; ssh_url_to_repo: string; web_url: string; visibility: GitLabProject['visibility'];
  empty_repo?: boolean; namespace: { id: number };
}
interface RawGroup { id: number; name: string; path: string; full_path: string; visibility: GitLabGroup['visibility'] }

export function toProject(raw: RawProject): GitLabProject {
  return {
    id: raw.id, name: raw.name, path: raw.path, pathWithNamespace: raw.path_with_namespace, namespaceId: raw.namespace.id,
    defaultBranch: raw.default_branch ?? null, httpUrlToRepo: raw.http_url_to_repo, sshUrlToRepo: raw.ssh_url_to_repo,
    webUrl: raw.web_url, visibility: raw.visibility, emptyRepo: raw.empty_repo ?? false,
  };
}

export function projectOperations(transport: Transport) {
  return {
    getProject: async (idOrPath: GitLabProjectRef): Promise<GitLabProject> => toProject(await transport.request<RawProject>('GET', `/projects/${encodeRef(idOrPath)}`)),
    createProject: async (input: CreateProjectInput): Promise<GitLabProject> => toProject(await transport.request<RawProject>('POST', '/projects', {
      body: {
        name: input.name,
        path: input.path,
        namespace_id: input.namespaceId,
        ...(input.defaultBranch ? { default_branch: input.defaultBranch } : {}),
        visibility: input.visibility ?? 'private',
        initialize_with_readme: input.initializeWithReadme ?? false,
      },
    })),
    /**
     * 默认只是标记删除（GitLab 会把路径改名为 `<path>-deletion_scheduled-<id>` 并在延迟期后清除）；
     * `permanentlyRemove` 对已标记删除的项目立即清除，GitLab 要求同时给出其当前 `fullPath` 以防误删。
     */
    deleteProject: async (id: GitLabProjectRef, options: DeleteProjectOptions = {}): Promise<void> => {
      const query = options.permanentlyRemove ? { permanently_remove: true, full_path: options.fullPath } : {};
      await transport.request<unknown>('DELETE', `/projects/${encodeRef(id)}`, { query });
    },
    getGroup: async (path: GitLabProjectRef): Promise<GitLabGroup> => {
      const raw = await transport.request<RawGroup>('GET', `/groups/${encodeRef(path)}`);
      return { id: raw.id, name: raw.name, path: raw.path, fullPath: raw.full_path, visibility: raw.visibility };
    },
  };
}
