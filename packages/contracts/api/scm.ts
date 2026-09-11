import { z } from 'zod';
import { ServiceIdSchema } from '../ids';

/** 每逻辑服务唯一的源码仓库绑定（R32）。 */
export const RepositoryBindingDtoSchema = z.object({
  serviceId: ServiceIdSchema,
  provider: z.literal('gitlab'),
  remoteProjectId: z.string(),
  pathWithNamespace: z.string(),
  httpUrl: z.url(),
  defaultBranch: z.string(),
  state: z.enum(['creating', 'ready', 'failed']),
  message: z.string().optional(),
  createdAt: z.iso.datetime(),
});

export const TagDtoSchema = z.object({ name: z.string(), commitSha: z.string(), createdAt: z.iso.datetime(), protected: z.boolean() });

export const CommitShaSchema = z.string().regex(/^[0-9a-f]{7,64}$/, 'commit sha 必须是 7–64 位十六进制');

/** 分支列表查询：给出两槽当前部署的提交，服务端据此计算各分支的落后数。 */
export const ListBranchesQuerySchema = z.object({ previewSha: CommitShaSchema.optional(), prodSha: CommitShaSchema.optional() });

/** 平台发布标签唯一合法形态（Design §6）：`v<major>.<minor>.<patch>`，手工打的其他标签不触发发布。 */
export const RELEASE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const ReleaseTagNameSchema = z.string().regex(RELEASE_TAG_PATTERN, '标签必须形如 v<major>.<minor>.<patch>');
export const TagBumpSchema = z.enum(['major', 'minor', 'patch']);

/** 发布打标：按 bump 递增最新标签，或显式指定完整标签名；二者只能给一个。 */
export const CreateReleaseTagRequestSchema = z.object({
  branch: z.string().min(1),
  bump: TagBumpSchema.optional(),
  tag: ReleaseTagNameSchema.optional(),
}).refine((v) => (v.bump === undefined) !== (v.tag === undefined), { message: 'bump 与 tag 必须且只能指定一个' });

export const ReleaseTagDtoSchema = z.object({ tag: ReleaseTagNameSchema, commitSha: CommitShaSchema });

/** 会话级短期 Git 凭据：明文只在签发响应里出现一次，平台只存哈希。 */
export const SessionCredentialDtoSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
  /** 形如 `http://cs-session:{token}@host/group/project.git`，调用方以明文替换 `{token}`。 */
  httpUrlWithCredentialTemplate: z.string().min(1),
});

export type RepositoryBindingDto = z.infer<typeof RepositoryBindingDtoSchema>;
export type TagDto = z.infer<typeof TagDtoSchema>;
export type ListBranchesQuery = z.infer<typeof ListBranchesQuerySchema>;
export type TagBump = z.infer<typeof TagBumpSchema>;
export type CreateReleaseTagRequest = z.infer<typeof CreateReleaseTagRequestSchema>;
export type ReleaseTagDto = z.infer<typeof ReleaseTagDtoSchema>;
export type SessionCredentialDto = z.infer<typeof SessionCredentialDtoSchema>;
