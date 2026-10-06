import { describe, expect, test } from 'bun:test';
import { DomainTopic } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { infrastructureOriginReferences } from './infrastructureOrigins';
import type { InfrastructureOriginDocument } from './infrastructureOrigins';

const project = Bun.randomUUIDv7(),service = Bun.randomUUIDv7(),operation = Bun.randomUUIDv7(),at = '2026-10-03T00:00:00Z';
const document = (channel: 'queue'|'event',name: string,payload: unknown): InfrastructureOriginDocument => ({channel,name,payload,legacyPayload:null,identityProvenance:null});
describe('infrastructure source reference extraction; ownership still requires public sources', () => {
  test('keeps current UUID and old opaque keys independently and refuses changed legacy/current content or forged provenance', () => {
    const payload = {projectId:project},legacy = {projectId:'old-project'};
    const input = {...document('queue','project.provision',payload),legacyPayload:legacy,
      identityProvenance:{version:'resource-identity/v1',sourceColumn:'legacy_payload',originalHash:jsonHash(legacy),normalizedHash:jsonHash(payload)}};
    expect(infrastructureOriginReferences(input)).toEqual({current:[{kind:'project',key:project}],legacy:[{kind:'project',key:'old-project'}]});
    expect(() => infrastructureOriginReferences({...input,legacyPayload:{projectId:'other-project'}})).toThrow('摘要');
    expect(() => infrastructureOriginReferences({...input,payload:{projectId:Bun.randomUUIDv7()}})).toThrow('摘要');
    expect(() => infrastructureOriginReferences({...input,identityProvenance:{...input.identityProvenance,version:'future/v2'}})).toThrow();
    expect(() => infrastructureOriginReferences({...input,legacyPayload:null})).toThrow('缺少');
    expect(() => infrastructureOriginReferences({...input,identityProvenance:null})).toThrow();
  });
  test('grant content follows its calling service rather than an operation in another project; policy content follows the provider', () => {
    expect(infrastructureOriginReferences(document('event',DomainTopic.grantChanged,{occurredAt:at,serviceId:service,operationId:operation,state:'granted'})))
      .toEqual({current:[{kind:'service',key:service}],legacy:[]});
    expect(infrastructureOriginReferences(document('event',DomainTopic.openPolicyChanged,{occurredAt:at,operationId:operation,openPolicy:'default'})))
      .toEqual({current:[{kind:'api-operation',key:operation}],legacy:[]});
  });
  test('unknown kinds, opaque current IDs, extra queue fields and malformed event facts are not treated as platform or other-project content', () => {
    expect(() => infrastructureOriginReferences(document('queue','future.job',{projectId:project}))).toThrow('未登记');
    for (const name of ['constructor','__proto__','toString']) expect(() => infrastructureOriginReferences(document('queue',name,{}))).toThrow('未登记');
    expect(() => infrastructureOriginReferences(document('event','future.event',{projectId:project}))).toThrow('未登记');
    expect(() => infrastructureOriginReferences(document('queue','project.provision',{projectId:'old-project'}))).toThrow();
    expect(() => infrastructureOriginReferences(document('queue','project.provision',{projectId:project,otherProject:service}))).toThrow();
    expect(() => infrastructureOriginReferences(document('event',DomainTopic.projectArchived,{projectId:project,occurredAt:'bad-date'}))).toThrow();
    expect(() => infrastructureOriginReferences(document('event',DomainTopic.projectArchived,{projectId:project,occurredAt:at,otherProject:service}))).toThrow();
    expect(() => infrastructureOriginReferences(document('event',DomainTopic.openPolicyChanged,{operationId:'old-operation',occurredAt:at,openPolicy:'default'}))).toThrow();
  });
  test('collector and controller IDs remain explicit unresolved origins; a valid UUID alone does not prove platform scope', () => {
    for (const [name,key,kind] of [
      ['cluster-management.metrics','requestId','cluster-metrics'],['cluster-management.storage','requestId','cluster-storage'],
      ['provisioning.project-deletion','operationId','deletion'],['task-runtime.development-parent-ending','endingId','parent-ending'],
      ['resource-access.apply','changeId','resource-change'],
    ] as const) expect(infrastructureOriginReferences(document('queue',name,{[key]:operation}))).toEqual({current:[{kind,key:operation}],legacy:[]});
    expect(infrastructureOriginReferences(document('queue','cluster-management.operation',{operationId:operation,resumeCount:1})).current).toEqual([{kind:'cluster-operation',key:operation}]);
    expect(() => infrastructureOriginReferences(document('queue','cluster-management.operation',{operationId:operation,resumeCount:-1}))).toThrow();
  });
  test('global maintenance legacy bodies have only a nonblank requestId, even when their migration digests match', () => {
    for (const name of ['cluster-management.refresh','cluster-management.metrics','cluster-management.storage']) {
      const input = document('queue',name,{requestId:operation});
      for (const legacy of [{requestId:'old-id',projectId:project},{requestId:'old-id',extra:null},{requestId:''},{requestId:' '},{requestId:1},{},[]]) {
        const proof = {version:'resource-identity/v1',sourceColumn:'legacy_payload',originalHash:jsonHash(legacy),normalizedHash:jsonHash(input.payload)};
        expect(() => infrastructureOriginReferences({...input,legacyPayload:legacy,identityProvenance:proof})).toThrow();
      }
    }
  });
});
