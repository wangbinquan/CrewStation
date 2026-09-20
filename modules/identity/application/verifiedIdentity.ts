import { ResourceIdSchema, TOKEN_CLAIMS } from '@crewstation/contracts';
import type { LegacyIdentityLookup } from '../ports/legacyIdentity';
import type { VerifiedToken } from '../ports/tokenService';

/** Runs only after signature, expiry and audience verification; lookup never grants access. */
export async function normalizeVerifiedIdentity(token: VerifiedToken | undefined, legacy?: LegacyIdentityLookup): Promise<VerifiedToken | undefined> {
  if (!token || !token.subject.startsWith(TOKEN_CLAIMS.subjectPrefixUser)) return token;
  const resolve = async (kind: string, value: unknown): Promise<string | undefined> => {
    if (typeof value !== 'string') return undefined;
    if (ResourceIdSchema.safeParse(value).success) return value;
    return legacy?.resolve(kind, [value]);
  };
  const user = await resolve('user', token.subject.slice(TOKEN_CLAIMS.subjectPrefixUser.length));
  if (!user) return legacy ? undefined : token;
  const claims = { ...token.claims };
  if (claims[TOKEN_CLAIMS.kind] === TOKEN_CLAIMS.kindDevSession) {
    for (const [kind, key] of [['task', TOKEN_CLAIMS.taskId], ['project', TOKEN_CLAIMS.project], ['service', TOKEN_CLAIMS.service]] as const) {
      const id = await resolve(kind, claims[key]);
      if (!id) return undefined;
      claims[key] = id;
    }
  }
  return { ...token, subject: `${TOKEN_CLAIMS.subjectPrefixUser}${user}`, claims };
}
