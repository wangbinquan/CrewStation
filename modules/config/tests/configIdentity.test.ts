import { describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, UserId } from '@crewstation/contracts';
import { newId } from '@crewstation/kernel';
import { ResourceIdSchema } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { configMigrations, createConfigModule } from '../wiring';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('configuration UUID identities', () => {
  test('concurrent template declarations are idempotent and never populate or overwrite environment values', async () => {
    const tdb = await createTestDatabase([eventbusMigrations, configMigrations]);
    try {
      const api = createConfigModule({ db: tdb.db, project: { authorize: async () => 'owner', isAdmin: async () => true }, settings: { secretKeyBase64: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64') } }).api;
      const actor: Actor = { userId: newId('usr') as UserId, isAdmin: true }, project = newId('prj') as ProjectId;
      const definition = { id: newId('cfg'), name: 'Greeting', bindingName: 'GREETING' };
      await Promise.all(Array.from({ length: 6 }, () => api.ensureTemplateDefinition(project, definition)));
      expect(await api.listDefinitions(actor, project)).toMatchObject([definition]);
      expect(await api.renderEnv(project, 'development')).toEqual({});
      const value = await api.createItem(actor, project, { ...definition, definitionId: definition.id, env: 'development', value: 'original', isSecret: false });
      await api.ensureTemplateDefinition(project, definition);
      expect(await api.renderEnv(project, 'development')).toEqual({ GREETING: 'original' });
      await expect(api.ensureTemplateDefinition(project, { ...definition, bindingName: 'OTHER' })).rejects.toMatchObject({ kind: 'conflict' });
      expect((await api.listItems(actor, project, 'development'))[0]!.id).toBe(value.id);
    } finally { await tdb.drop(); }
  });
  test('environment values share a definition, have independent IDs and retain historical bindings after rename and recreation', async () => {
    const tdb = await createTestDatabase([eventbusMigrations, configMigrations]);
    try {
      const api = createConfigModule({ db: tdb.db, project: { authorize: async () => 'owner', isAdmin: async () => true }, settings: { secretKeyBase64: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64') } }).api;
      const actor: Actor = { userId: newId('usr') as UserId, isAdmin: true }, project = newId('prj') as ProjectId;
      const input = { env: 'development' as const, name: 'Greeting', bindingName: 'GREETING', value: 'hello', isSecret: false };
      const dev = await api.createItem(actor, project, input);
      const prod = await api.createItem(actor, project, { ...input, env: 'production', definitionId: dev.definitionId, value: 'production' });
      expect(ResourceIdSchema.safeParse(dev.id).success).toBe(true);
      expect(prod.id).not.toBe(dev.id);
      expect(prod.definitionId).toBe(dev.definitionId);
      await expect(api.createItem(actor, project, input)).rejects.toMatchObject({ kind: 'conflict' });
      await expect(api.updateItem(actor, project, 'GREETING', input)).rejects.toMatchObject({ kind: 'not_found' });
      const renamed = await api.updateItem(actor, project, dev.id, { ...input, name: '欢迎语', expectedVersion: dev.version, value: 'new' });
      expect(renamed).toMatchObject({ id: dev.id, definitionId: dev.definitionId, name: '欢迎语' });
      expect(await api.renderDefinitions(project, 'development', dev.version)).toEqual({ [dev.definitionId]: 'hello' });
      expect(await api.renderEnv(project, 'production')).toEqual({ GREETING: 'production' });
      await expect(api.deleteItem(actor, project, 'development', dev.id, dev.version)).rejects.toMatchObject({ kind: 'conflict' });
      await api.deleteItem(actor, project, 'development', dev.id, renamed.version);
      const replacement = await api.createItem(actor, project, { ...input, definitionId: dev.definitionId });
      expect(replacement.id).not.toBe(dev.id);
      const history = await api.listVersions(actor, project, 'development');
      expect(history[0]!.entries[0]).toMatchObject({ itemId: dev.id, definitionId: dev.definitionId, bindingName: 'GREETING', name: 'Greeting' });
      expect(await api.validateManifestEnv(project, 'production', [{ name: 'OTHER', from: 'config', configDefinitionId: dev.definitionId }])).toEqual({ missing: [] });
      await expect(api.createItem(actor, newId('prj') as ProjectId, { ...input, definitionId: dev.definitionId })).rejects.toMatchObject({ kind: 'not_found' });
    } finally { await tdb.drop(); }
  });
});
