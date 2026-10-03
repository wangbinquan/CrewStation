import { describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES, PROJECT_DELETION_PARTICIPANTS, PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import type { Actor, ProjectDeletionInventory } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import { resourceIdentityDirectory } from '@crewstation/persistence';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createProjectModule, projectMigrations } from '../wiring';

const available = await testDatabaseAvailable();
async function fixture() {
  const database = await createTestDatabase([eventbusMigrations,identityMigrations,projectMigrations]);
  const identity = createIdentityModule({ db:database.db,settings:{adminEmails:['project-origin@tests.invalid']} });
  const user = await identity.api.ensureUser({ externalId:'source-admin',name:'Admin',email:'project-origin@tests.invalid' });
  const admin: Actor = {userId:user.id,isAdmin:true};
  const project = createProjectModule({ db:database.db,identity:identity.api,hosts:{prodHost:(s) => `${s}.test`,previewHost:(s) => `preview.${s}.test`,serviceHost:(s) => `${s}.svc.test`},
    settings:{defaultServicePlan:BUILTIN_RESOURCES.servicePlanSmall,defaultMaxConcurrentTasks:3} });
  const make = (slug: string) => project.api.createProject(admin,{slug,name:'private project name',kind:'DigitalWorker',template:BUILTIN_RESOURCES.minimalTemplate});
  return {database,project,admin,make};
}
describe.skipIf(!available)('project infrastructure origins (real PG; ownership only)', () => {
  test('canonical and explicit legacy sources agree without returning names; unknown or malformed identities never become platform scope', async () => {
    const f = await fixture();
    try {
      const own = await f.make('original-source'),other = await f.make('retained-source');
      const directory = resourceIdentityDirectory(f.database.db,() => [projectMigrations]);
      await directory.bind('project','project',['old-project-key'],own.id);
      await directory.bind('project','service',['old-service-key'],own.serviceId!);
      const current = await f.project.api.originalInfrastructureOwnership('project',own.id);
      expect(current).toMatchObject({complete:true,id:own.id,scope:'project',projectIds:[own.id]});
      expect(await f.project.api.originalInfrastructureOwnership('project','old-project-key','legacy')).toEqual(current);
      const service = await f.project.api.originalInfrastructureOwnership('service',own.serviceId!);
      expect(service?.projectIds).toEqual([own.id]);
      expect(await f.project.api.originalInfrastructureOwnership('service','old-service-key','legacy')).toEqual(service);
      expect((await f.project.api.originalInfrastructureOwnership('service',other.serviceId!))?.projectIds).toEqual([other.id]);
      expect(JSON.stringify(current)).not.toContain('private project name'); expect(JSON.stringify(service)).not.toContain('original-source');
      expect(await f.project.api.originalInfrastructureOwnership('project',newResourceId())).toBeUndefined();
      expect(await f.project.api.originalInfrastructureOwnership('service','unknown-old-key','legacy')).toBeUndefined();
      await expect(f.project.api.originalInfrastructureOwnership('project','original-source')).rejects.toThrow();
      await expect(f.project.api.originalInfrastructureOwnership('other' as never,own.id)).rejects.toThrow('未登记');
    } finally { await f.database.drop(); }
  });
  test('completed minimum project and operation origins survive root removal and slug reuse; missing service history stays missing', async () => {
    const f = await fixture();
    try {
      const own = await f.make('reused-origin'),before = await f.project.api.originalInfrastructureOwnership('project',own.id);
      const metadata = await f.project.api.inspectProjectDeletionMetadata(own.id);
      // Other owners are explicitly empty for this module test, not evidence of real platform resource reclamation.
      const reports: ProjectDeletionInventory[] = PROJECT_DELETION_PARTICIPANTS.map((participant) => participant === 'project' ? metadata
        : {participant,complete:true,revision:jsonHash(participant),resources:[],references:[],blockers:[]});
      const plan = await f.project.api.prepareDeletionPlan(f.admin,own.id,reports);
      const operation = await f.project.api.acceptProjectDeletion(f.admin,own.id,{planId:plan.id,requestKey:newResourceId(),confirm:'delete'},reports);
      const originalOperation = await f.project.api.originalInfrastructureOwnership('deletion',operation.id);
      expect(originalOperation?.projectIds).toEqual([own.id]);
      const claimed = (await f.project.api.claimProjectDeletion(operation.id,'source-test'))!;
      for (const phase of PROJECT_DELETION_PHASES) for (const participant of [...PROJECT_DELETION_PARTICIPANTS.filter((p) => p !== 'project'),'project' as const]) {
        const step = participant === 'project' ? await f.project.api.deletionOwner.run({operationId:operation.id,generation:claimed.lease.generation,
          phase,target:plan.target,confirmed:plan.participants.find((p) => p.participant === 'project')!}) : {kind:'done' as const,evidence:{kind:'not-applicable' as const,digest:jsonHash({participant,phase}),description:'Empty owner fixture only',count:0}};
        if (step.kind !== 'done') throw new Error('Project module did not complete '+phase);
        await f.project.api.recordProjectDeletionReceipt(claimed.lease,participant,phase,step.evidence);
      }
      await f.project.api.completeProjectDeletion(claimed.lease);
      expect((await f.database.db.execute(sql`SELECT id FROM project.projects WHERE id=${own.id}`)).length).toBe(0);
      expect(await f.project.api.originalInfrastructureOwnership('project',own.id)).toEqual(before);
      expect(await f.project.api.originalInfrastructureOwnership('deletion',operation.id)).toEqual(originalOperation);
      expect(await f.project.api.originalInfrastructureOwnership('service',own.serviceId!)).toBeUndefined();
      const replacement = await f.make(own.slug);
      expect(replacement.id).not.toBe(own.id);
      expect((await f.project.api.originalInfrastructureOwnership('project',replacement.id))?.projectIds).toEqual([replacement.id]);
      expect(await f.project.api.originalInfrastructureOwnership('project',own.id)).toEqual(before);
      await f.database.db.execute(sql`UPDATE project.deletion_operations SET body=jsonb_set(body,'{project,id}',to_jsonb(${replacement.id}::text)) WHERE id=${operation.id}`);
      await expect(f.project.api.originalInfrastructureOwnership('deletion',operation.id)).rejects.toThrow('最小身份不一致');
      await expect(f.project.api.originalInfrastructureOwnership('project',own.id)).rejects.toThrow('最小身份不一致');
    } finally { await f.database.drop(); }
  },15_000);
});
