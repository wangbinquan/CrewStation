import {expect,test} from 'bun:test';
import {CreateDatabaseRestoreSchema,ServiceDatabaseRestoreSchema,DatabaseRestoreVerificationSchema,SwitchDatabaseRestoreSchema} from './databaseRestore';
test('restore operator input has no arbitrary DSN, command, environment or executable image',()=>{
 const request={requestId:Bun.randomUUIDv7(),expectedActiveGenerationId:Bun.randomUUIDv7(),expectedActiveReleaseId:Bun.randomUUIDv7(),restoreReleaseId:Bun.randomUUIDv7(),backupReference:'aw-backup:sha256'};
 expect(CreateDatabaseRestoreSchema.parse(request)).toMatchObject(request);
 for(const key of ['dsn','command','image','env','actorUserId'])expect(CreateDatabaseRestoreSchema.safeParse({...request,[key]:'arbitrary'}).success).toBe(false);
 expect(ServiceDatabaseRestoreSchema.safeParse({command:[],verifyCommand:['app','verify']}).success).toBe(false);
 expect(ServiceDatabaseRestoreSchema.safeParse({command:['app','restore'],verifyCommand:['app','verify']}).success).toBe(true);
 expect(SwitchDatabaseRestoreSchema.safeParse({expectedRevision:2,confirmationDigest:'a'.repeat(64),force:true}).success).toBe(false);
});
test('verification cannot replace platform physical identity and must attest all required checks',()=>{
 const value={version:1,backupReferenceDigest:'a'.repeat(64),schemaDigest:'sha256:'+'b'.repeat(64),complete:true,autoResumeSuspended:true};
 expect(DatabaseRestoreVerificationSchema.safeParse(value).success).toBe(true);
 for(const change of [{complete:false},{autoResumeSuspended:false},{version:2},{target:{databaseOid:'123'}},{backupReferenceDigest:'unchecked'}])expect(DatabaseRestoreVerificationSchema.safeParse({...value,...change}).success).toBe(false);
});
