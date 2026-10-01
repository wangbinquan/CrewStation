/** 本模块需要的远端仓库能力子集；GitLab 的作用域、访问级别等细节在 adapters/gitlab 内决定。 */
export interface RemoteProject {
  readonly id: string;
  readonly pathWithNamespace: string;
  readonly defaultBranch: string | undefined;
  /** GitLab 自报的项目网页地址（按它的 external_url）：给浏览器打开用，克隆与推送不用它。 */
  readonly webUrl: string;
}

export interface RemoteBranch {
  readonly name: string;
  readonly headSha: string;
  readonly isDefault: boolean;
}

export interface RemoteTag {
  readonly name: string;
  readonly commitSha: string;
  /** ISO 8601（UTC）。 */
  readonly createdAt: string;
  readonly protected: boolean;
}

export interface RemoteAccessToken {
  readonly id: string;
  /** 明文只在这里出现一次。 */
  readonly token: string;
}

export interface RemoteRepositoryIdentity {
  readonly id: string;
  readonly pathWithNamespace: string;
  readonly createdAt: string;
}
export interface RemoteRepositoryRemoval {
  /** 只返回 API 身份；404 仍抛错，不能用它证明实际存储已回收。 */
  read(id: string): Promise<RemoteRepositoryIdentity & { readonly markedForDeletionOn?: string | null }>;
  storage(id: string): Promise<readonly { readonly projectId: string; readonly diskPath: string; readonly createdAt: string; readonly repositoryStorage: string }[]>;
  credentials(id: string): Promise<readonly { readonly id: string; readonly name: string; readonly active: boolean; readonly revoked: boolean; readonly createdAt: string }[]>;
  /** 再核对 ID/创建时间/当前路径后发请求；受理不表示物理完成。 */
  request(identity: RemoteRepositoryIdentity, permanentlyRemove: boolean): Promise<void>;
}

export interface GitLabGateway {
  /** 未实现的外部适配器明确不支持，正式 owner 必须阻断。 */
  readonly removal?: RemoteRepositoryRemoval;
  findProject(pathWithNamespace: string): Promise<RemoteProject | undefined>;
  createProject(input: { groupPath: string; slug: string; defaultBranch: string }): Promise<RemoteProject>;
  listBranches(remoteProjectId: string): Promise<RemoteBranch[]>;
  getBranch(remoteProjectId: string, name: string): Promise<RemoteBranch | undefined>;
  listTags(remoteProjectId: string): Promise<RemoteTag[]>;
  /** 指定引用处的文件原文；不存在返回 undefined。 */
  readFile(remoteProjectId: string, path: string, ref: string): Promise<string | undefined>;
  resolveCommit(remoteProjectId: string, ref: string): Promise<string | undefined>;
  listTree(remoteProjectId: string, ref: string): Promise<readonly { path: string; mode: string; type: 'tree' | 'blob' | 'commit' }[]>;
  createTag(remoteProjectId: string, input: { name: string; ref: string; message: string }): Promise<RemoteTag>;
  /** 幂等：匹配 `pattern` 的标签只允许维护者（平台）创建。 */
  ensureTagProtection(remoteProjectId: string, pattern: string): Promise<void>;
  /** `to` 可达而 `from` 不可达的提交数；任一引用不存在时返回 undefined。 */
  countCommitsBehind(remoteProjectId: string, refs: { from: string; to: string }): Promise<number | undefined>;
  /** 只读写仓库、开发者级别的项目访问令牌；`expiresOn` 为 `YYYY-MM-DD`。 */
  createAccessToken(remoteProjectId: string, input: { name: string; expiresOn: string; readOnly?: boolean }): Promise<RemoteAccessToken>;
  /** 幂等：远端已不存在视为成功。 */
  revokeAccessToken(remoteProjectId: string, tokenId: string): Promise<void>;
}
