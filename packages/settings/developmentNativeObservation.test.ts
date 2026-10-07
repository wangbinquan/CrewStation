// Explicit validation admissions are unlimited metadata; the default producer remains off.
import {expect,test} from 'bun:test';
import {developmentNativeObservationAdmissions as parse} from './developmentNativeObservation';
import {loadPlatformSettings} from './platformSettings';
const id=(n:number)=>`019f0000-0000-7000-8000-${String(n).padStart(12,'0')}`;
const first={projectId:id(1),profileId:id(2),profileRevision:2},second={projectId:id(3),profileId:id(4),profileRevision:5};
const base={CS_DATABASE_URL:'postgres://test:test@localhost/test',CS_SECRET_KEY:'test',POD_IP:'10.244.0.106'};
test('missing and empty selection stay off; actual platform settings carry only explicit normalized tuples',()=>{
 expect(parse(undefined)).toEqual([]);expect(parse('[]')).toEqual([]);expect(loadPlatformSettings(base).developmentNativeObservationAdmissions).toEqual([]);
 expect(parse(JSON.stringify([second,{...first,projectId:first.projectId.toUpperCase(),profileId:first.profileId.toUpperCase()}]))).toEqual([first,second]);
 expect(loadPlatformSettings({...base,CS_DEVELOPMENT_NATIVE_OBSERVATION_ADMISSIONS:JSON.stringify([first])}).developmentNativeObservationAdmissions).toEqual([first]);
});
test('every invalid or duplicate tuple rejects instead of widening or truncating selection',()=>{
 const invalid:unknown[]=[null,{},'all',true,1,[null],[first,first],[first,{...first,projectId:first.projectId.toUpperCase()}],
  [{...first,profileRevision:0}],[{...first,profileRevision:1.5}],[{...first,profileRevision:Number.MAX_SAFE_INTEGER+1}],
  [{...first,profileId:'profile-name'}],[{...first,projectId:'project-name'}],[{...first,extra:true}], [{projectId:first.projectId,profileId:first.profileId}], [{...first,profileRevision:'2'}]];
 for(const value of invalid)expect(()=>parse(JSON.stringify(value))).toThrow('CS_DEVELOPMENT_NATIVE_OBSERVATION_ADMISSIONS');
 for(const raw of ['','invalid-json','['])expect(()=>parse(raw)).toThrow('CS_DEVELOPMENT_NATIVE_OBSERVATION_ADMISSIONS');
});
test('all 10001 actual configured tuples survive normalization without an admission population ceiling',()=>{
 const tuples=Array.from({length:10001},(_,n)=>({projectId:id(1),profileId:id(n+10),profileRevision:2}));
 const result=parse(JSON.stringify(tuples));expect(result).toHaveLength(10001);expect(result.at(-1)).toEqual(tuples.at(-1));expect(new Set(result.map(row=>row.profileId)).size).toBe(10001);
});
