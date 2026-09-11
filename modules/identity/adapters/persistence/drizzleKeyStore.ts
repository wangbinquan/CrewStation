import type { Executor } from '@crewstation/persistence';
import { eq } from 'drizzle-orm';
import type { KeyStore } from '../../ports/keyStore';
import { signingKeys } from './tables';

const RING_NAME = 'default';

/** identity.signing_keys 只有一行；create 用 ON CONFLICT DO NOTHING 解决多副本首次启动的竞争。 */
export function drizzleKeyStore(db: Executor): KeyStore {
  return {
    load: async () => (await db.select({ material: signingKeys.material }).from(signingKeys).where(eq(signingKeys.name, RING_NAME)))[0]?.material,
    create: async (serialized) => {
      const inserted = await db.insert(signingKeys).values({ name: RING_NAME, material: serialized }).onConflictDoNothing().returning({ name: signingKeys.name });
      return inserted.length > 0;
    },
    replace: async (serialized) => {
      await db.update(signingKeys).set({ material: serialized, updatedAt: new Date() }).where(eq(signingKeys.name, RING_NAME));
    },
  };
}
