// RFC-034: platform-only identities reuse the original numerical revision/baseline algorithm, with no fake project.
import {expect,test} from 'bun:test';
import {newResourceId} from '@crewstation/kernel';
import type {PlatformUsageIdentity} from '@crewstation/contracts';
import {rebuildUsageProjection,type UsageEvidence} from './usageProjection';
const identity:PlatformUsageIdentity={kind:'profile-test',testId:newResourceId(),executionId:newResourceId(),executionGeneration:1};
const sample=(revision:number,input:string):UsageEvidence<PlatformUsageIdentity>=>({kind:'usage',identity,sourceId:'original-platform',recordId:'native-step',revision,occurredAt:'2026-10-12T00:00:00.000Z',observedAt:'2026-10-12T00:00:00.000Z',modelRef:null,adapterVersion:'original',reporting:'delta',inclusion:'self',coverage:'complete',validity:revision===2?'correction':'valid',scope:null,coveredThroughTurn:null,basis:{kind:'invocation'},usage:{input,cacheRead:'7',cacheWrite:'11',output:'13'}});
test('exact classified usage, duplicate replay and a lower native correction keep the independent platform identity',()=>{
 const a=sample(1,'9007199254740997'),first=rebuildUsageProjection([a]);expect(first.identity).toEqual(identity);expect(Object.hasOwn(first.identity,'projectId')).toBe(false);expect(first.projection.contribution).toEqual(a.usage);
 expect(rebuildUsageProjection([a,a],first)).toBe(first);const second=rebuildUsageProjection([sample(2,'17'),a],first);expect(second.projection.contribution.input).toBe('17');expect(second.projection.projectionRevision).toBe(2);
});
