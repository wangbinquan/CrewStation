// GitLab 兼容 HTTP 客户端：项目、分支、提交、标签、保护标签、访问令牌、Webhook；纯协议，无平台语义。
export type { GitLabClient, GitLabClientOptions } from './client';
export { createGitLabClient } from './client';
export { extractMessage, mapGitLabError, redactSecret } from './errors';
export type { GitLabErrorContext } from './errors';
export { GITLAB_ACCESS_LEVEL } from './models';
export type {
  AddWebhookInput, CreateProjectAccessTokenInput, CreateProjectInput, CreateTagInput, DeleteProjectOptions, GitLabAccessLevel, GitLabAccessToken, GitLabBranch,
  GitLabCommit, GitLabCompareResult, GitLabCreatedAccessToken, GitLabGroup, GitLabProject, GitLabProjectRef, GitLabProtectedTag,
  GitLabProtectedTagAccess, GitLabTag, GitLabTreeEntry, GitLabVisibility, GitLabWebhook, GitLabWebhookEvent, ProtectTagInput, RepositoryTreeOptions,
} from './models';
