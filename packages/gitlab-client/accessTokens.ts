import type { CreateProjectAccessTokenInput, GitLabCreatedAccessToken, GitLabProjectRef } from './models';
import type { Transport } from './transport';
import { encodeRef } from './transport';

interface RawAccessToken {
  id: number; name: string; scopes: string[]; access_level: number; expires_at: string | null;
  active: boolean; revoked: boolean; created_at: string; user_id: number; token: string;
}

/** GitLab 令牌到期只接受 `YYYY-MM-DD`；Date 取 UTC 日期。 */
export function formatExpiryDate(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().slice(0, 10);
}

export function accessTokenOperations(transport: Transport) {
  const base = (id: GitLabProjectRef): string => `/projects/${encodeRef(id)}/access_tokens`;
  return {
    /** 响应里的 `token` 明文只出现这一次；调用方自行保管，本客户端不缓存不记录。 */
    createProjectAccessToken: async (id: GitLabProjectRef, input: CreateProjectAccessTokenInput): Promise<GitLabCreatedAccessToken> => {
      const raw = await transport.request<RawAccessToken>('POST', base(id), {
        body: { name: input.name, scopes: [...input.scopes], expires_at: formatExpiryDate(input.expiresAt), access_level: input.accessLevel },
      });
      return {
        id: raw.id, name: raw.name, scopes: raw.scopes, accessLevel: raw.access_level, expiresAt: raw.expires_at,
        active: raw.active, revoked: raw.revoked, createdAt: raw.created_at, userId: raw.user_id, token: raw.token,
      };
    },
    revokeProjectAccessToken: async (id: GitLabProjectRef, tokenId: number): Promise<void> => {
      await transport.request<unknown>('DELETE', `${base(id)}/${tokenId}`);
    },
  };
}
