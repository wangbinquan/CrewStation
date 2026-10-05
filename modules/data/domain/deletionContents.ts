import { z } from 'zod';
import { ProjectIdSchema, ProjectDeletionEvidenceSchema, PROJECT_DELETION_PHASES } from '@crewstation/contracts';

/** Explicit owned keys and parent relations; shared backends, plans, rotations and global controls are retained. */
export interface DataContentTable {
  readonly table: string; readonly keys: readonly string[];
  readonly from?: string; readonly project?: string; readonly service?: string; readonly task?: string;
  readonly invalid?: string; readonly origin?: string; readonly physical?: boolean;
}
const space = (table: string, keys = ['id']): DataContentTable => ({ table, keys, from: `data.${table} r LEFT JOIN data.object_spaces s ON s.id=r.space_id`, project: 's.project_id', service: 's.service_id', invalid: 's.id IS NULL' });
const binding = (table: string, keys: string[]): DataContentTable => ({ table, keys, from: `data.${table} r LEFT JOIN data.finalization_bindings b ON b.id=r.binding_id LEFT JOIN data.object_spaces s ON s.id=b.space_id`, project: 's.project_id', service: 's.service_id', task: 'b.task_id', invalid: 'b.id IS NULL OR s.id IS NULL' });
export const DATA_CONTENT: readonly DataContentTable[] = [
  { table: 'resources', keys: ['id'], project: 'r.project_id', service: 'r.service_id', origin: 'resource', invalid: "r.kind<>'postgres'" },
  { table: 'task_bindings', keys: ['id'], project: 'r.project_id', service: 'r.service_id', task: 'r.task_id', origin: 'data-binding' },
  { table: 'resource_allocations', keys: ['operation_id'], project: 'r.project_id' },
  { table: 'object_project_policies', keys: ['project_id'], project: 'r.project_id' },
  { table: 'object_work', keys: ['id'], project: 'r.project_id', service: "r.body->>'serviceId'", origin: 'object-work', physical: true,
    invalid: "data.object_work_birth_valid(to_jsonb(r)) IS DISTINCT FROM true OR r.state='running' AND (r.exit_digest IS NOT NULL OR r.recovery_digest IS NOT NULL) OR r.state='finished' AND r.exit_digest IS DISTINCT FROM encode(sha256(convert_to(r.body::text,'UTF8')),'hex')" },
  { table: 'object_spaces', keys: ['id'], project: 'r.project_id', service: 'r.service_id', origin: 'space', physical: true,
    invalid: "r.body->>'id' IS DISTINCT FROM r.id OR r.body->>'projectId' IS DISTINCT FROM r.project_id OR r.body->>'serviceId' IS DISTINCT FROM r.service_id OR r.body->>'backendId' IS DISTINCT FROM r.backend_id OR NOT EXISTS(SELECT 1 FROM data.object_backends p WHERE p.id=r.backend_id)" },
  { ...space('object_uploads'), origin: 'upload', invalid: "s.id IS NULL OR r.body->>'id' IS DISTINCT FROM r.id OR r.body->>'spaceId' IS DISTINCT FROM r.space_id" },
  { ...space('object_upload_attempts'), origin: 'attempt', physical: true,
    invalid: "s.id IS NULL OR r.body->>'id' IS DISTINCT FROM r.id OR r.body->>'spaceId' IS DISTINCT FROM r.space_id OR r.body->>'uploadId' IS DISTINCT FROM r.upload_id OR r.body->>'backendId' IS DISTINCT FROM r.backend_id OR NOT EXISTS(SELECT 1 FROM data.object_uploads p WHERE p.id=r.upload_id AND p.space_id=r.space_id)" },
  { ...space('objects'), origin: 'object', physical: true, invalid: "s.id IS NULL OR r.body->>'id' IS DISTINCT FROM r.id OR r.body->>'spaceId' IS DISTINCT FROM r.space_id OR NOT EXISTS(SELECT 1 FROM data.object_upload_attempts p WHERE p.id=r.body->>'attemptId' AND p.space_id=r.space_id AND p.body->>'key'=r.body->>'key' AND p.backend_id=r.body->>'backendId' AND p.body->>'placementRevision'=r.body->>'placementRevision')" },
  { ...space('object_mutations', ['space_id','request_key']) },
  { ...space('object_read_transfers'), physical: true, origin: 'read-transfer', invalid: 's.id IS NULL OR NOT EXISTS(SELECT 1 FROM data.objects p WHERE p.id=r.object_id AND p.space_id=r.space_id)' },
  { table: 'object_references', keys: ['object_id','owner_type','owner_id','revision'], from: 'data.object_references r LEFT JOIN data.objects o ON o.id=r.object_id LEFT JOIN data.object_spaces s ON s.id=o.space_id', project: 's.project_id', service: 's.service_id', invalid: 'o.id IS NULL OR s.id IS NULL' },
  { table: 'object_write_control', keys: ['service_id'], service: 'r.service_id' },
  { ...space('archive_plans'), task: 'r.task_id', origin: 'archive-plan' },
  { ...space('finalization_bindings'), task: 'r.task_id', origin: 'archive-binding' },
  binding('archive_binding_revisions', ['binding_id','revision']),
  { ...binding('archive_helper_grants', ['id']), origin: 'helper', physical: true },
  binding('archive_file_results', ['binding_id','revision','path']),
  { table: 'archive_helper_closures', keys: ['id'], from: 'data.archive_helper_closures r LEFT JOIN data.archive_helper_grants g ON g.id=r.id LEFT JOIN data.finalization_bindings b ON b.id=g.binding_id LEFT JOIN data.object_spaces s ON s.id=b.space_id', project: 's.project_id', service: 's.service_id', task: 'b.task_id', invalid: 'g.id IS NULL OR b.id IS NULL OR s.id IS NULL' },
  { table: 'task_object_inputs', keys: ['task_id'], project: "r.body->>'projectId'", service: "r.body->>'serviceId'", task: 'r.task_id', origin: 'task-input', physical: true,
    invalid: "r.body->>'taskId' IS DISTINCT FROM r.task_id OR NOT EXISTS(SELECT 1 FROM data.object_spaces s WHERE s.id=r.body->>'spaceId' AND s.project_id=r.body->>'projectId' AND s.service_id=r.body->>'serviceId')" },
  { table: 'task_input_grants', keys: ['id'], from: 'data.task_input_grants r LEFT JOIN data.task_object_inputs p ON p.task_id=r.task_id', project: "p.body->>'projectId'", service: "p.body->>'serviceId'", task: 'r.task_id', origin: 'input-grant', physical: true, invalid: "p.task_id IS NULL OR r.body->>'taskId' IS DISTINCT FROM r.task_id" },
];
export const DATA_SHARED = ['object_backends','object_plans','object_credential_rotations','object_storage_freezes','object_backups','object_transfer_stops','storage_contract','resource_identity_aliases'] as const;
/** Every platform byte request holds this shared admission. Native exclusive
 * block reclamation closes it briefly, including foreign-project requests. */
export const DATA_NATIVE_BLOCK_ADMISSION = 'data.native-block-admission';
/** Children are removed before parents; no shared owner record is deleted. */
export const DATA_REMOVAL = ['archive_helper_closures','archive_file_results','archive_binding_revisions','archive_helper_grants','task_input_grants','task_object_inputs','object_references','object_read_transfers','object_mutations','object_work','object_upload_attempts','objects','object_uploads','archive_plans','finalization_bindings','object_write_control','resource_allocations','object_project_policies','task_bindings','resources','object_spaces'] as const;

const digest = z.string().regex(/^[a-f0-9]{64}$/), count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const DataDeletionScopeSchema = z.object({
  contents: z.array(z.object({ table: z.enum(DATA_REMOVAL), key: z.string().min(1), digest }).strict()),
  origins: z.array(z.object({ kind: z.string().min(1), key: z.string().min(1), id: z.string().min(1), projectId: ProjectIdSchema }).strict()),
  locations: z.array(z.object({ backendId: z.string().min(1), placementRevision: z.number().int().positive(), key: z.string().min(1), size: count }).strict()),
  placements: z.array(z.object({ spaceId: z.uuid(), backendId: z.uuid(), placementRevision: z.number().int().positive() }).strict()).optional(),
  backendReleases: z.array(z.object({ backendId: z.string().min(1), bytes: count, transfers: count }).strict()),
  objectsPresent: z.boolean(), digest, count, compacted: z.boolean(),
  nativeHistory: z.object({ version: z.literal(1), identity: digest, digest, body: z.json() }).strict().optional(),
}).strict();
export const DataDeletionProofsSchema = z.partialRecord(z.enum(PROJECT_DELETION_PHASES), ProjectDeletionEvidenceSchema);
