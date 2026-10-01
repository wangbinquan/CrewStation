import { PlatformError } from '@crewstation/kernel';
import type { GitLabProjectDeletionState, GitLabRepositoryStorage } from './models';
import type { Transport } from './transport';
import { encodeRef } from './transport';

const invalid = () => new PlatformError('unavailable', 'GitLab 原项目或存储身份不完整');
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value);
const timestamp = (value: unknown): value is string => text(value) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const relativePath = (value: unknown): value is string => text(value) && !value.startsWith('/') && !value.includes('\\') && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
function originalId(id: number | string) {
  if (!/^[1-9][0-9]*$/.test(String(id)) || !Number.isSafeInteger(Number(id))) throw new PlatformError('validation', 'GitLab 原项目必须使用有效数字 ID');
  return Number(id);
}
function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid();
  return raw as Record<string, unknown>;
}
function state(raw: unknown, id: number): GitLabProjectDeletionState {
  const row = record(raw);
  if (row.id !== id || !relativePath(row.path_with_namespace) || !timestamp(row.created_at) || row.marked_for_deletion_on !== undefined && row.marked_for_deletion_on !== null && !date(row.marked_for_deletion_on)) throw invalid();
  return { id, pathWithNamespace: row.path_with_namespace, createdAt: row.created_at,
    ...(row.marked_for_deletion_on === undefined ? {} : { markedForDeletionOn: row.marked_for_deletion_on as string | null }) };
}
function storage(raw: unknown, id: number): GitLabRepositoryStorage {
  const row = record(raw);
  if (row.project_id !== id || !relativePath(row.disk_path) || !timestamp(row.created_at) || !text(row.repository_storage)) throw invalid();
  return { projectId: id, diskPath: row.disk_path, createdAt: row.created_at, repositoryStorage: row.repository_storage };
}

export function projectDeletionOperations(transport: Transport) {
  return {
    getProjectDeletionState: async (id: number | string): Promise<GitLabProjectDeletionState> => {
      const original = originalId(id); return state(await transport.request<unknown>('GET', `/projects/${encodeRef(original)}`), original);
    },
    getProjectRepositoryStorage: async (id: number | string): Promise<GitLabRepositoryStorage[]> => {
      const original = originalId(id), raw = await transport.request<unknown>('GET', `/projects/${encodeRef(original)}/storage`);
      const rows = Array.isArray(raw) ? raw : [raw];
      if (!rows.length) throw invalid();
      return rows.map((row) => storage(row, original));
    },
  };
}
