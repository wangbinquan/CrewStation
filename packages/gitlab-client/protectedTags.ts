import type { GitLabProjectRef, GitLabProtectedTag, ProtectTagInput } from './models';
import type { Transport } from './transport';
import { encodeRef } from './transport';

interface RawProtectedTag { name: string; create_access_levels?: Array<{ access_level: number; access_level_description: string }> }

const toProtectedTag = (raw: RawProtectedTag): GitLabProtectedTag => ({
  name: raw.name,
  createAccessLevels: (raw.create_access_levels ?? []).map((l) => ({ accessLevel: l.access_level, accessLevelDescription: l.access_level_description })),
});

export function protectedTagOperations(transport: Transport) {
  const base = (id: GitLabProjectRef): string => `/projects/${encodeRef(id)}/protected_tags`;
  return {
    listProtectedTags: async (id: GitLabProjectRef): Promise<GitLabProtectedTag[]> => (await transport.requestAll<RawProtectedTag>(base(id))).map(toProtectedTag),
    /** `name` 支持通配（如 `v*`）；`createAccessLevel` 决定谁能创建匹配的标签。 */
    protectTag: async (id: GitLabProjectRef, input: ProtectTagInput): Promise<GitLabProtectedTag> =>
      toProtectedTag(await transport.request<RawProtectedTag>('POST', base(id), { body: { name: input.name, create_access_level: input.createAccessLevel } })),
  };
}
