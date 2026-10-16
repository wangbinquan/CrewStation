// RFC-034: numeric admission needs the fixed launch before any credential/material preparation.
import { afterEach, describe, expect, test } from 'bun:test';
import type { Actor, UserId } from '@crewstation/contracts';
import { CreateComputeProfileRequestSchema } from '@crewstation/contracts';
import { newResourceId, noopLogger, systemClock } from '@crewstation/kernel';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { launchVersionUseCases } from '../application/launchVersions';
import type { AgentRuntimeUseCaseDeps } from '../application/dependencies';
import { resolveProfileUseCases } from '../application/resolveProfile';
import type { ProfileLaunchMetadata } from '../api/moduleApi';
import type { AgentRuntimeModuleDeps } from '../wiring';
import { agentRuntimeMigrations, createAgentRuntimeModule } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase | undefined;
afterEach(async () => { await tdb?.drop(); tdb = undefined; });
const admin: Actor = { userId: newResourceId() as UserId, isAdmin: true };
async function fixture() {
  tdb = await createTestDatabase([queueMigrations, agentRuntimeMigrations]);
  const state = { decrypts: 0, credentialReads: 0 }, layout = { pullBase: 'registry.fixture:5000', pushHost: 'registry.fixture', baseRepository: 'crewstation/task-runtime', runtimePrefix: 'runtime/' };
  const cipher = { encrypt: async (value: string) => `fixture:${value}`, decrypt: async () => { state.decrypts++; throw new Error('metadata must not decrypt'); } };
  const registry = { layout, resolveDigest: async () => `sha256:${'a'.repeat(64)}` };
  const deps: AgentRuntimeModuleDeps = { db: tdb.db, isAdmin: async () => true, settings: { secretKeyBase64: Buffer.alloc(32, 7).toString('base64'), registry: { ...layout, scheme: 'http', baseTag: 'dev' } }, cipher, registry,
    taskProfiles: { exists: async () => true }, executor: { run: async () => { throw new Error('no test/model execution'); } }, references: { listReferencingProjects: async () => [] } };
  const module = createAgentRuntimeModule(deps), uow = drizzleUnitOfWork(tdb.db);
  const resolver = resolveProfileUseCases({ ...deps, defaultTaskProfile: 'fixture-small', uow: { ...uow, read: { ...uow.read, credentials: { ...uow.read.credentials, list: async () => { state.credentialReads++; throw new Error('metadata must not read credentials'); } } } }, projects: { authorize: async () => {}, name: async () => 'Fixture project' }, cipher, registry, clock: systemClock, logger: noopLogger });
  const input = CreateComputeProfileRequestSchema.parse({ name: 'Frozen compute', content: { image: 'runtime/model:1', launch: { protocol: 'opencode', binaryPath: '/opt/opencode', model: 'configured-old' }, taskProfile: newResourceId(), secrets: [{ id: newResourceId(), name: 'TOKEN' }] } });
  const profile = await module.api.createProfile(admin, input);
  return { module, resolver, state, input, profile, deps, uow, ref: { profileId: profile.id, revision: 1 } };
}

describe.skipIf(!available)('fixed launch metadata on actual profile PG records', () => {
  test('module and use case return only fixed launch with no credential read, decrypt or Hook even when secrets are unset', async () => {
    const f = await fixture();
    const expected: ProfileLaunchMetadata = { id: f.profile.id, name: 'Frozen compute', revision: 1, protocol: 'opencode', image: `registry.fixture:5000/runtime/model@sha256:${'a'.repeat(64)}`, launch: f.input.content.launch, taskProfile: f.input.content.taskProfile };
    expect(await f.module.api.launchMetadata(f.ref)).toEqual(expected);
    expect(await f.resolver.launchMetadata(f.ref)).toEqual(expected);
    expect(f.state).toEqual({ decrypts: 0, credentialReads: 0 });
    await expect(f.module.api.launchMaterial(f.ref)).rejects.toMatchObject({ kind: 'precondition', details: { code: 'profile_secret_missing' } });
    expect(f.state.decrypts).toBe(0);
  });

  test('a newer revision and disabled profile do not change an accepted old launch; display names remain mutable', async () => {
    const f = await fixture(), first = await f.module.api.launchMetadata(f.ref);
    await f.module.api.saveProfile(admin, f.profile.id, { expectedRevision: 1, name: 'Current display name', content: { ...f.input.content, launch: { ...f.input.content.launch, model: 'configured-new' } }, credentials: {} });
    await f.module.api.setEnabled(admin, f.profile.id, false);
    expect(await f.module.api.launchMetadata(f.ref)).toEqual({ ...first, name: 'Current display name' });
    expect((await f.module.api.launchMetadata({ ...f.ref, revision: 2 })).launch.model).toBe('configured-new');
    expect((await f.resolver.launchMetadata(f.ref)).launch.model).toBe('configured-old');
    expect(f.state).toEqual({ decrypts: 0, credentialReads: 0 });
  });

  test('missing fixed revision and missing profile give explicit owner-facing failure and never borrow current launch', async () => {
    const f = await fixture();
    for (const ref of [{ ...f.ref, revision: 99 }, { profileId: newResourceId(), revision: 1 }]) {
      await expect(f.module.api.launchMetadata(ref)).rejects.toMatchObject({ kind: 'precondition', details: { code: 'profile_revision_missing', ...ref } });
      await expect(f.resolver.launchMetadata(ref)).rejects.toMatchObject({ kind: 'precondition' });
    }
    expect(f.state).toEqual({ decrypts: 0, credentialReads: 0 });
  });
});

test.skipIf(!available)('RFC-040 fixed model material decrypts only retained credentials, even when current credentials cannot be read',async()=>{
 const f=await fixture(),secretId=f.input.content.secrets[0]!.id;
 await f.module.api.saveProfile(admin,f.profile.id,{expectedRevision:1,name:'Fixed model',content:f.input.content,credentials:{[secretId]:{op:'replace',value:'original-key'}}});
 const ref={profileId:f.profile.id,revision:2},stamp=await f.module.api.pinLaunchVersion(ref);
 const decrypted:string[]=[];
 const deps={...f.deps,defaultTaskProfile:'fixture-small',clock:systemClock,logger:noopLogger,projects:{authorize:async()=>{},name:async()=> 'Fixture'},uow:{...f.uow,read:{...f.uow.read,credentials:{...f.uow.read.credentials,list:async()=>{throw new Error('today credentials are unavailable');}}}},cipher:{...f.deps.cipher!,decrypt:async(value:string)=>{decrypted.push(value);if(value!=='fixture:original-key')throw new Error('wrong credential revision');return 'original-key';}}} as AgentRuntimeUseCaseDeps;
 const versions=launchVersionUseCases(deps,async()=>{throw new Error('must not use live material');});
 await f.module.api.saveProfile(admin,f.profile.id,{expectedRevision:2,name:'Changed model',content:{...f.input.content,launch:{...f.input.content.launch,model:'new-model'}},credentials:{[secretId]:{op:'replace',value:'rotated-key'}}});
 const restored=await versions.launchMaterialAt(ref,stamp);expect(restored.launch.model).toBe('configured-old');expect(restored.beforeStart.secrets).toEqual({TOKEN:'original-key'});expect(decrypted).toEqual(['fixture:original-key']);
 await expect(versions.launchMaterialAt(ref,'missing-stamp')).rejects.toMatchObject({kind:'precondition',details:{code:'secret_version_unavailable'}});
});
