import { eq } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import type { CredentialStore, StoredCredential } from '../../ports/credentials';
import { credentials } from './tables';

/** 口令密文按记录 ID 存（I28）；先到先得——并发的两次建角色只留第一次生成的那个口令。 */
export function drizzleCredentialStore(db: Database): CredentialStore {
  const get = async (resourceId: string): Promise<StoredCredential | undefined> => {
    const [row] = await db.select().from(credentials).where(eq(credentials.resourceId, resourceId)).limit(1);
    return row ? { resourceId: row.resourceId, role: row.role, secretBox: row.secretBox } : undefined;
  };
  return {
    get,
    putIfAbsent: async (credential) => {
      await db.insert(credentials).values({ resourceId: credential.resourceId, role: credential.role, secretBox: credential.secretBox }).onConflictDoNothing({ target: credentials.resourceId });
      return (await get(credential.resourceId))!;
    },
  };
}
