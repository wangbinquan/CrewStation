import { Store } from './store';

/** The release Job uses the same entry point as the cold-database acceptance test. */
export async function migrate(url = process.env.CS_DATABASE_URL): Promise<void> {
  if (!url) throw new Error('缺少 CS_DATABASE_URL');
  const store = new Store(url);
  try { await store.migrate(); } finally { await store.db.close(); }
}
if (import.meta.main) await migrate();
