import { describe, expect, test } from 'bun:test';
import { DomainTopic } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import type { ProjectId } from '@crewstation/contracts';
import { resolveInfrastructureOwnership } from './infrastructureOwnership';
import type { InfrastructureOriginDocument } from '../domain/infrastructureOrigins';
import type { InfrastructureOriginSources, OriginalInfrastructureOrigin } from '../ports/infrastructureOrigins';

const project = Bun.randomUUIDv7() as ProjectId,other = Bun.randomUUIDv7() as ProjectId,delivery = Bun.randomUUIDv7();
const document = (name:string,payload:unknown,channel:'queue'|'event'='queue'): InfrastructureOriginDocument => ({channel,name,payload,legacyPayload:null,identityProvenance:null});
const witnessed = (id:string,projectIds:readonly ProjectId[],scope:'project'|'platform'='project'): OriginalInfrastructureOrigin =>
  ({complete:true,id,projectIds,scope,revision:jsonHash({id,projectIds:[...projectIds].sort(),scope})});
describe('infrastructure ownership witnesses (controlled public sources; no physical proof)', () => {
  test('current UUID and old opaque key must identify the same unchanged original; the result keeps only minimum IDs and digests', async () => {
    const input = {...document('project.provision',{projectId:project}),legacyPayload:{projectId:'old-project'},
      identityProvenance:{version:'resource-identity/v1',sourceColumn:'legacy_payload',originalHash:jsonHash({projectId:'old-project'}),normalizedHash:jsonHash({projectId:project})}};
    const calls:string[] = [],sources: InfrastructureOriginSources = {resolve:async (_doc,ref,representation) => {calls.push(representation+':'+ref.key);return witnessed(project,[project]);}};
    const result = await resolveInfrastructureOwnership(input,sources);
    expect(result).toMatchObject({scope:'project',projectIds:[project],origins:[{kind:'project',id:project}]});
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(result)).not.toContain('old-project');
    expect(calls).toEqual(['current:'+project,'legacy:old-project']);
    await expect(resolveInfrastructureOwnership(input,{resolve:async (_doc,_ref,representation) => witnessed(representation==='legacy'?other:project,[project])})).rejects.toThrow('旧键');
    await expect(resolveInfrastructureOwnership(input,{resolve:async (_doc,_ref,representation) => ({...witnessed(project,[project]),revision:jsonHash(representation)})})).rejects.toThrow('来源');
  });
  test('unknown/unreadable/incomplete sources never become an empty or platform scope; the current canonical ID must match', async () => {
    const input = document('project.provision',{projectId:project});
    await expect(resolveInfrastructureOwnership(input,{resolve:async () => undefined})).rejects.toThrow('不可读取');
    await expect(resolveInfrastructureOwnership(input,{resolve:async () => {throw new Error('source unavailable');}})).rejects.toThrow('source unavailable');
    await expect(resolveInfrastructureOwnership(input,{resolve:async () => witnessed(other,[project])})).rejects.toThrow('当前 ID');
    await expect(resolveInfrastructureOwnership(input,{resolve:async () => ({...witnessed(project,[project]),complete:false} as never)})).rejects.toThrow();
    await expect(resolveInfrastructureOwnership(input,{resolve:async () => witnessed(project,[project,project])})).rejects.toThrow();
    await expect(resolveInfrastructureOwnership(input,{resolve:async () => witnessed(project,[project],'platform')})).rejects.toThrow();
  });
  test('conflicting project/service/task sources block the whole content rather than assigning it to any one of them', async () => {
    const service = Bun.randomUUIDv7(),task = Bun.randomUUIDv7();
    const input = document(DomainTopic.taskCreated,{projectId:project,serviceId:service,taskId:task,kind:'business',occurredAt:'2026-10-03T00:00:00Z'},'event');
    await expect(resolveInfrastructureOwnership(input,{resolve:async (_doc,ref) => witnessed(ref.key,[ref.kind==='task'?other:project])})).rejects.toThrow('归属冲突');
  });
  test('cross-project deliveries retain their complete original set; platform scope requires an explicit complete source', async () => {
    const linked = await resolveInfrastructureOwnership(document('events.deliver',{deliveryId:delivery}),{resolve:async () => witnessed(delivery,[other,project])});
    expect(linked.projectIds).toEqual([project,other].sort()); expect(linked.origins[0]?.id).toBe(delivery);
    const request = Bun.randomUUIDv7(),platform = await resolveInfrastructureOwnership(document('agent-runtime.profile-test',{testId:request}),{resolve:async () => witnessed(request,[],'platform')});
    expect(platform).toMatchObject({scope:'platform',projectIds:[]});
    await expect(resolveInfrastructureOwnership(document('agent-runtime.profile-test',{testId:request}),{resolve:async () => witnessed(request,[])})).rejects.toThrow();
  });
  test('approved global maintenance contracts retain current and legacy jobs without calling expired collector or project sources', async () => {
    let calls = 0;
    const sources: InfrastructureOriginSources = { resolve: async () => { calls++; throw new Error('global contract must not call original collector sources'); } };
    for (const name of ['cluster-management.refresh','cluster-management.metrics','cluster-management.storage']) {
      const input = document(name,{requestId:Bun.randomUUIDv7()}),legacy = {requestId:'original-opaque-collector'};
      const old = {...input,legacyPayload:legacy,identityProvenance:{version:'resource-identity/v1',sourceColumn:'legacy_payload',originalHash:jsonHash(legacy),normalizedHash:jsonHash(input.payload)}};
      const current = await resolveInfrastructureOwnership(input,sources),historical = await resolveInfrastructureOwnership(old,sources);
      expect(current).toMatchObject({scope:'platform',projectIds:[],origins:[]});
      expect(historical).toMatchObject({scope:'platform',projectIds:[],origins:[]});
      expect(current.digest).toMatch(/^[a-f0-9]{64}$/); expect(historical.digest).not.toBe(current.digest);
      expect((await resolveInfrastructureOwnership({...input,payload:{requestId:Bun.randomUUIDv7()}},sources)).digest).not.toBe(current.digest);
      expect(JSON.stringify(historical)).not.toContain(legacy.requestId);
    }
    expect(calls).toBe(0);
  });
  test('the global exception rejects malformed bodies and forged migration facts; unknown and project-operation sources still block', async () => {
    let calls = 0;
    const sources: InfrastructureOriginSources = { resolve: async () => { calls++; return undefined; } };
    for (const name of ['cluster-management.refresh','cluster-management.metrics','cluster-management.storage']) {
      const input = document(name,{requestId:Bun.randomUUIDv7()});
      for (const payload of [{requestId:'old-id'},{requestId:project,projectId:project},{requestId:project,extra:null},{},null]) {
        await expect(resolveInfrastructureOwnership({...input,payload},sources)).rejects.toThrow();
      }
      for (const legacy of [{requestId:'old-id',projectId:project},{requestId:'old-id',extra:null},{requestId:''},{requestId:' '},{requestId:1},{},[]]) {
        const migrated = {...input,legacyPayload:legacy,identityProvenance:{version:'resource-identity/v1',sourceColumn:'legacy_payload',originalHash:jsonHash(legacy),normalizedHash:jsonHash(input.payload)}};
        await expect(resolveInfrastructureOwnership(migrated,sources)).rejects.toThrow();
      }
      const legacy = {requestId:'old-id'},proof = {version:'resource-identity/v1',sourceColumn:'legacy_payload',originalHash:jsonHash(legacy),normalizedHash:jsonHash(input.payload)};
      for (const identityProvenance of [null,{...proof,originalHash:'0'.repeat(64)},{...proof,normalizedHash:'0'.repeat(64)},{...proof,version:'future/v2'},{...proof,extra:true}]) {
        await expect(resolveInfrastructureOwnership({...input,legacyPayload:legacy,identityProvenance},sources)).rejects.toThrow();
      }
      await expect(resolveInfrastructureOwnership({...input,channel:'event'},sources)).rejects.toThrow();
      await expect(resolveInfrastructureOwnership({...input,identityProvenance:proof},sources)).rejects.toThrow();
    }
    expect(calls).toBe(0);
    await expect(resolveInfrastructureOwnership(document('cluster-management.future',{requestId:project}),sources)).rejects.toThrow('未登记');
    await expect(resolveInfrastructureOwnership(document('cluster-management.operation',{operationId:project}),sources)).rejects.toThrow('不可读取');
    expect(calls).toBe(1);
  });
});
