import { expect, test } from 'bun:test';
import { LABELS } from '@crewstation/k8s';
import { jobRenderOf } from '../../domain/jobRender';
import { jobSecretObject, releaseJobObject } from './jobObjects';
for(const action of ['plan','run','verify','rollback','complete'] as const)test(`RFC-044 ${action} Job has dedicated Secret, bounded emptyDir and one-hour deadline`,()=>{
 const purpose=`database-migration-${action}` as const,id=Bun.randomUUIDv7(),name='dbm-'+id.replaceAll('-',''),namespace='cs-migration';
 const input={children:[{kind:'Job',namespace,name},{kind:'Secret',namespace,name:name+'-env'}],job:{releaseId:id,purpose,image:'registry/app@sha256:'+'a'.repeat(64),command:['app',action==='verify'?'verify-migration':'migrate'],env:{},envSecret:name+'-env',resources:{cpu:'75m',memory:'256Mi'},activeDeadlineSeconds:3600,ttlSecondsAfterFinished:86400,scratchSize:'30Gi'}};
 const render=jobRenderOf(input)!;expect(render.purpose).toBe(purpose);const job=releaseJobObject(render);
 expect(job.metadata.labels).toMatchObject({[LABELS.component]:purpose,[LABELS.release]:id});
 expect(job.spec).toMatchObject({activeDeadlineSeconds:3600,template:{spec:{volumes:[{name:'migration-scratch',emptyDir:{sizeLimit:'30Gi'}}],containers:[{command:input.job.command,image:input.job.image,env:[],envFrom:[{secretRef:{name:name+'-env'}}],volumeMounts:[{name:'migration-scratch',mountPath:'/tmp/database-migration'}]}]}}});
 const secret=jobSecretObject(render,{CS_DATABASE_MIGRATION_TARGET_URL:'postgres://target',CS_DATABASE_MIGRATION_CONTROL_URL:'http://api/job/token'});expect(secret.immutable).toBe(true);expect(JSON.stringify(job)).not.toContain('postgres://');expect(secret.stringData).toMatchObject({CS_DATABASE_MIGRATION_TARGET_URL:'postgres://target'});
 expect(jobRenderOf({...input,job:{...input.job,purpose:'database-migration-new-run'}})).toBeUndefined();
});
