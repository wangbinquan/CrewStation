import { expect, test } from 'bun:test';
import { migrationCanonical, migrationDigest, MIGRATION_LOG_LIMIT, parseMigrationMarker } from './evidence';
const operationId='dbm_e2_12345678';
test('full migration log parses canonical multiline receipt and rejects missing, duplicate, truncated and oversized output',()=>{
 const payload={operationId,kind:'verified'},receipt={payload,digest:migrationDigest(payload)},text=migrationCanonical(receipt);
 expect(parseMigrationMarker('before\nCS_DATABASE_MIGRATION_RECEIPT='+text+'after\n')).toEqual({kind:'receipt',text});
 for(const log of ['nothing','CS_DATABASE_MIGRATION_RECEIPT='+JSON.stringify(receipt),'CS_DATABASE_MIGRATION_RECEIPT='+text.slice(0,-1),'CS_DATABASE_MIGRATION_RECEIPT='+text+'CS_DATABASE_MIGRATION_RECEIPT='+text,'x'.repeat(MIGRATION_LOG_LIMIT+1)])expect(parseMigrationMarker(log)).toBeNull();
 expect(parseMigrationMarker('CS_DATABASE_MIGRATION_RECEIPT='+text.replace('verified','completed'))).toBeNull();
});
test('single-line approval request is distinct from receipt and cannot be split across lines',()=>{
 const text=JSON.stringify({operationId,runId:'run',planDigest:'sha256:'+'a'.repeat(64),approvalDigest:'sha256:'+'b'.repeat(64),planPath:null});
 expect(parseMigrationMarker('logs\nCS_DATABASE_MIGRATION_PLAN='+text+'\n')).toEqual({kind:'plan',text});expect(parseMigrationMarker('CS_DATABASE_MIGRATION_PLAN=\n'+text)).toBeNull();
});
