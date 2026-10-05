import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { ProjectDeletionContextSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';

/** Private source-to-controller revalidation. The public user API cannot issue
 * native permits; the original running lease and stored plan are re-read. */
export function projectDeletionGrantRouter(input: { token: string; assertGrant(context: ProjectDeletionContext): Promise<void> }) {
  if (input.token.length < 32) throw Error('Project deletion requires a dedicated native-source token');
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const credential = digest('Bearer ' + input.token), assertGrant = input.assertGrant;
  const router = new Hono<AppEnv>();
  router.post('/internal/project-deletion/grant', async c => {
    if (!timingSafeEqual(credential, digest(c.req.header('authorization') ?? ''))) return c.body(null, 401);
    try {
      const reader = c.req.raw.body?.getReader(); if (!reader) return c.body(null, 400);
      const chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) {
        const row = await reader.read(); if (row.done) break;
        size += row.value.byteLength; if (size > 8_388_608) throw Error('grant budget'); chunks.push(row.value);
      } } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const context = ProjectDeletionContextSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
      if (!context.confirmed.complete || context.confirmed.references.length || context.confirmed.blockers.length
        || !(context.confirmed.participant === 'scm' && ['stop', 'purge'].includes(context.phase)
          || ['release', 'runtime-environment'].includes(context.confirmed.participant) && context.phase === 'purge')) return c.body(null, 403);
      await assertGrant(context); return c.body(null, 204);
    } catch { return c.body(null, 403); }
  });
  return router;
}

export const projectDeletionGrantRoutes = (settings: { grantToken: string } | undefined, assertGrant: (context: ProjectDeletionContext) => Promise<void>) =>
  settings ? [projectDeletionGrantRouter({ token: settings.grantToken, assertGrant })] : [];
