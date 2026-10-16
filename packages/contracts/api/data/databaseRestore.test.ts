import {expect,test} from 'bun:test';
import {AbandonDatabaseRestoreSchema,CreateDatabaseRestoreSchema,DatabaseRestoreJobReceiptSchema,DatabaseRestoreStageSchema,ServiceDatabaseRestoreSchema,DatabaseRestoreVerificationSchema,SwitchDatabaseRestoreSchema} from './databaseRestore';
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
// RFC-042 review: AW trims CS_DATABASE_RESTORE_REFERENCE before hashing while CS hashes the exact
// bytes. Surrounding whitespace is rejected at admission so both sides derive one digest.
test('backup references with surrounding whitespace are rejected; abandon and named attempt failures are explicit', () => {
 const request={requestId:Bun.randomUUIDv7(),expectedActiveGenerationId:Bun.randomUUIDv7(),expectedActiveReleaseId:Bun.randomUUIDv7(),restoreReleaseId:Bun.randomUUIDv7(),backupReference:'aw-backup:sha256'};
 for(const backupReference of [' aw-backup:sha256','aw-backup:sha256 ','aw-backup:sha256\t'])expect(CreateDatabaseRestoreSchema.safeParse({...request,backupReference}).success).toBe(false);
 expect(CreateDatabaseRestoreSchema.safeParse({...request,backupReference:'aw backup:sha256'}).success).toBe(true);
 expect(DatabaseRestoreStageSchema.parse('abandoned')).toBe('abandoned');
 expect(AbandonDatabaseRestoreSchema.safeParse({expectedRevision:3}).success).toBe(true);expect(AbandonDatabaseRestoreSchema.safeParse({expectedRevision:3,deleteTarget:true}).success).toBe(false);
 const receipt={name:'job',uid:'uid',image:'registry/app@sha256:'+'a'.repeat(64),target:{serverId:'s',databaseOid:'1',roleOid:'2'},state:'failed',exitCode:null};
 for(const failure of ['deadline-exceeded','job-lost','pod-missing','receipt-invalid','receipt-mismatch','exit'])expect(DatabaseRestoreJobReceiptSchema.safeParse({...receipt,failure}).success).toBe(true);
 expect(DatabaseRestoreJobReceiptSchema.safeParse({...receipt,failure:'guessed'}).success).toBe(false);
});
