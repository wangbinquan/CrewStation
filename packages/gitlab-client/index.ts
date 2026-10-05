// GitLab 兼容 HTTP 客户端：项目、分支、提交、标签、保护标签、访问令牌、Webhook；纯协议，无平台语义。
export type { GitLabClient, GitLabClientOptions } from './client';
export { createGitLabClient } from './client';
export { extractMessage, mapGitLabError, redactSecret } from './errors';
export type { GitLabErrorContext } from './errors';
export { GITLAB_ACCESS_LEVEL } from './models';
export { createGitLabNativeClient, parseGitLabNativeOutput } from './native/client';
export { GITLAB_NATIVE_STORAGE_KINDS, GitLabNativeRequestSchema, GitLabNativeInventorySchema, GitLabNativeInstanceSchema } from './native/protocol';
export type { GitLabNativeRequest, GitLabNativeInventory, GitLabNativeInstance } from './native/protocol';
export { createGitLabNativeHandler } from './native/server';
export type { GitLabNativeObserver } from './native/server';
export { createGitLabStorageClient, parseGitLabStorageOutput } from './native/storage/client';
export { createGitLabStorageHandler } from './native/storage/server';
export { GitLabStorageRequestSchema, GitLabStorageRootsSchema, GitLabStorageInventorySchema } from './native/storage/protocol';
export type { GitLabStorageRequest, GitLabStorageRoots, GitLabStorageInventory } from './native/storage/protocol';
export type { GitLabStorageObserver } from './native/storage/server';
export type {
  AddWebhookInput, CreateProjectAccessTokenInput, CreateProjectInput, CreateTagInput, DeleteProjectOptions, GitLabAccessLevel, GitLabAccessToken, GitLabBranch,
  GitLabCommit, GitLabCompareResult, GitLabCreatedAccessToken, GitLabGroup, GitLabProject, GitLabProjectArchivalState, GitLabProjectDeletionState, GitLabProjectRef, GitLabProtectedTag, GitLabRepositoryStorage,
  GitLabProtectedTagAccess, GitLabTag, GitLabTreeEntry, GitLabVisibility, GitLabWebhook, GitLabWebhookEvent, ProtectTagInput, RepositoryTreeOptions,
} from './models';
