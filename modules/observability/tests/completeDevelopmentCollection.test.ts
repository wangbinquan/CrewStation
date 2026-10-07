// Metadata-only validation selection must never become a historical task or record population filter.
import {expect,test} from 'bun:test';
import type {ProjectId} from '@crewstation/contracts';
import {jsonHash,newResourceId} from '@crewstation/kernel';
import {developmentCollectionConfiguration} from '../application/complete-statistics/sourceCollection';
const project=()=>newResourceId() as ProjectId;
test('missing and empty installation selection retain the original disabled state',()=>{
 for(const admissions of [undefined,[]]){const selected=developmentCollectionConfiguration(admissions);expect(selected(null)).toBeUndefined();expect(selected(project())).toBeUndefined();}
});
test('canonical installation metadata freezes all tuples, has project-local display scope, and does not retain mutable caller arrays',()=>{
 const a=project(),b=project(),profileId=newResourceId(),one={projectId:a,profileId,profileRevision:2},two={projectId:b,profileId,profileRevision:3},admissions=[two,one],selected=developmentCollectionConfiguration(admissions),same=developmentCollectionConfiguration([one,two]);
 expect(selected(null)).toEqual(same(null));expect(selected(a)).toEqual({development:'validation-selected',configurationDigest:jsonHash({version:2,admissions:[one]})});expect(selected(b)).toEqual({development:'validation-selected',configurationDigest:jsonHash({version:2,admissions:[two]})});expect(selected(project())).toBeUndefined();
 admissions[0]!.profileRevision=99;admissions.splice(1);expect(selected(null)).toEqual(same(null));expect(selected(a)).toEqual(same(a));
});
test('all 10001 installation tuples contribute to the digest and the last tuple changes it; this is not a reporting row limit',()=>{
 const projectId=project(),admissions=Array.from({length:10001},(_,n)=>({projectId,profileId:newResourceId(),profileRevision:n+1})),sorted=[...admissions].sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:1);
 const selected=developmentCollectionConfiguration(admissions);expect(selected(null)).toEqual({development:'validation-selected',configurationDigest:jsonHash({version:2,admissions:sorted})});expect(selected(projectId)).toEqual(selected(null));expect(developmentCollectionConfiguration(admissions.slice(0,-1))(null)).not.toEqual(selected(null));
});
