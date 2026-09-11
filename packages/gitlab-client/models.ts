/** GitLab REST v4 的资源形状（字段改为 camelCase）；只描述协议，不含任何平台语义。 */

/** 项目既可用数字 ID 也可用 `group/sub/project` 路径引用；路径会被 URL 编码。 */
export type GitLabProjectRef = number | string;

export type GitLabVisibility = 'private' | 'internal' | 'public';

/** GitLab 访问级别常量（`access_level` 数值）。 */
export const GITLAB_ACCESS_LEVEL = {
  noAccess: 0,
  minimal: 5,
  guest: 10,
  planner: 15,
  reporter: 20,
  developer: 30,
  maintainer: 40,
  owner: 50,
} as const;
export type GitLabAccessLevel = (typeof GITLAB_ACCESS_LEVEL)[keyof typeof GITLAB_ACCESS_LEVEL];

export interface GitLabProject {
  readonly id: number;
  readonly name: string;
  readonly path: string;
  readonly pathWithNamespace: string;
  readonly namespaceId: number;
  /** 空仓库为 null。 */
  readonly defaultBranch: string | null;
  readonly httpUrlToRepo: string;
  readonly sshUrlToRepo: string;
  readonly webUrl: string;
  readonly visibility: GitLabVisibility;
  readonly emptyRepo: boolean;
}

export interface GitLabGroup {
  readonly id: number;
  readonly name: string;
  readonly path: string;
  readonly fullPath: string;
  readonly visibility: GitLabVisibility;
}

export interface GitLabCommit {
  readonly id: string;
  readonly shortId: string;
  readonly title: string;
  readonly message: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authoredDate: string;
  readonly committedDate: string;
  readonly parentIds: readonly string[];
}

export interface GitLabBranch {
  readonly name: string;
  readonly commit: GitLabCommit;
  readonly default: boolean;
  readonly protected: boolean;
  readonly merged: boolean;
}

export interface GitLabTag {
  readonly name: string;
  readonly message: string | null;
  readonly target: string;
  readonly commit: GitLabCommit;
  readonly protected: boolean;
}

export interface GitLabProtectedTagAccess {
  readonly accessLevel: number;
  readonly accessLevelDescription: string;
}

export interface GitLabProtectedTag {
  readonly name: string;
  readonly createAccessLevels: readonly GitLabProtectedTagAccess[];
}

export interface GitLabCompareResult {
  /** `to` 可达而 `from` 不可达的提交数，即 `from` 落后 `to` 的提交数。 */
  readonly commitCount: number;
  readonly commits: readonly GitLabCommit[];
  readonly compareSameRef: boolean;
  readonly compareTimeout: boolean;
}

export interface GitLabAccessToken {
  readonly id: number;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly accessLevel: number;
  /** `YYYY-MM-DD`；GitLab 的令牌到期只有日期精度。 */
  readonly expiresAt: string | null;
  readonly active: boolean;
  readonly revoked: boolean;
  readonly createdAt: string;
  readonly userId: number;
}

/** 创建响应独有 `token` 明文；GitLab 之后不再返回它。 */
export interface GitLabCreatedAccessToken extends GitLabAccessToken {
  readonly token: string;
}

export type GitLabWebhookEvent =
  | 'push' | 'tag_push' | 'issues' | 'merge_requests' | 'note' | 'pipeline' | 'job' | 'wiki_page' | 'deployment' | 'releases';

export interface GitLabWebhook {
  readonly id: number;
  readonly projectId: number;
  readonly url: string;
  readonly events: readonly GitLabWebhookEvent[];
  readonly enableSslVerification: boolean;
  readonly createdAt: string;
}

export interface GitLabTreeEntry {
  readonly id: string;
  readonly name: string;
  readonly type: 'tree' | 'blob' | 'commit';
  readonly path: string;
  readonly mode: string;
}

export interface CreateProjectInput {
  readonly name: string;
  readonly path: string;
  readonly namespaceId: number;
  readonly defaultBranch?: string;
  readonly visibility?: GitLabVisibility;
  /** 默认 false：平台自己推首个提交，不让 GitLab 生成 README。 */
  readonly initializeWithReadme?: boolean;
}

export interface DeleteProjectOptions {
  readonly permanentlyRemove?: boolean;
  /** 永久删除时必须与项目当前的 path_with_namespace 一致。 */
  readonly fullPath?: string;
}

export interface CreateTagInput {
  readonly name: string;
  readonly ref: string;
  readonly message?: string;
}

export interface ProtectTagInput {
  readonly name: string;
  readonly createAccessLevel: GitLabAccessLevel;
}

export interface CreateProjectAccessTokenInput {
  readonly name: string;
  readonly scopes: readonly string[];
  /** Date 或 `YYYY-MM-DD`；Date 取其 UTC 日期。 */
  readonly expiresAt: Date | string;
  readonly accessLevel: GitLabAccessLevel;
}

export interface AddWebhookInput {
  readonly url: string;
  readonly token?: string;
  readonly events: readonly GitLabWebhookEvent[];
  readonly enableSslVerification?: boolean;
}

export interface RepositoryTreeOptions {
  readonly ref?: string;
  readonly recursive?: boolean;
}
