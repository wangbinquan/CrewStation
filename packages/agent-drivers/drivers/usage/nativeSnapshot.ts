import { Database } from 'bun:sqlite';
import { jsonHash } from '@crewstation/kernel';
import { opencodeOutput } from './opencodeOutput';
import type { NativeUsageStep, NativeUsageOrder } from '@crewstation/contracts';
import { identifier, object, readUsage } from './capture';

export interface NativeUsageSnapshot { order?: NativeUsageOrder; steps: NativeUsageStep[]; sessions: number; fingerprint: string | null; issues: string[] }
interface PartRow { id: string; session_id: string; message_id: string; time_created: number; kind: string; tokens: string | null; provider: string | null; model: string | null }
interface Session { id: string; parent_id: string | null }
interface ScanNode { id: string; ancestors: string[] }
export interface NativeScanOptions { maxSessions?: number; maxSteps?: number; maxParts?: number; maxDepth?: number; budgetMs?: number; clock?: () => number }
interface ScanState { steps: NativeUsageStep[]; sessions: ScanNode[]; issues: Set<string>; parts: number; deadline: number; clock: () => number; limits: Required<Omit<NativeScanOptions, 'clock' | 'budgetMs'>> }

function step(row: PartRow, ancestors: string[], issues: Set<string>): NativeUsageStep {
  const tokens = object(JSON.parse(row.tokens ?? 'null')), cache = object(tokens?.cache), diagnostics: string[] = [];
  const usage = readUsage({ input: tokens?.input, output: opencodeOutput(tokens, diagnostics), cacheRead: cache?.read, cacheWrite: cache?.write }, diagnostics);
  if (Object.values(usage).some((value) => value === null)) issues.add('native-token-bucket-unknown');
  const provider = identifier(row.provider), model = identifier(row.model);
  const actualModel = provider && provider.length <= 200 && model && model.length <= 300 ? { provider, model, condition: null } : null;
  if (!actualModel) issues.add('native-model-unavailable');
  const occurredAt = Number.isSafeInteger(row.time_created) && row.time_created >= 0 && row.time_created < 253402300800000 ? new Date(row.time_created).toISOString() : null;
  if (!occurredAt) issues.add('native-time-unavailable');
  return { id: row.id, sessionId: row.session_id, parentSessionId: ancestors.at(-1) ?? null, ancestors, occurredAt, usage, actualModel };
}
function readParts(db: Database, node: ScanNode, state: ScanState): boolean {
  const rows = db.query<PartRow, [string, number]>(`SELECT p.id, p.session_id, p.message_id, p.time_created,
    json_extract(p.data, '$.type') AS kind,
    CASE WHEN json_extract(p.data, '$.type')='step-finish' THEN json_extract(p.data, '$.tokens') END AS tokens,
    CASE WHEN json_extract(m.data, '$.role')='assistant' THEN json_extract(m.data, '$.providerID') END AS provider,
    CASE WHEN json_extract(m.data, '$.role')='assistant' THEN json_extract(m.data, '$.modelID') END AS model
    FROM part p LEFT JOIN message m ON m.id=p.message_id AND m.session_id=p.session_id
    WHERE p.session_id=? ORDER BY p.id LIMIT ?`).all(node.id, Math.max(0, state.limits.maxParts - state.parts) + 1);
  if (rows.length + state.parts > state.limits.maxParts) { state.issues.add('native-part-budget'); return false; }
  state.parts += rows.length;
  const opened = new Map<string, number>();
  for (const row of rows) {
    const delta = row.kind === 'step-start' ? 1 : row.kind === 'step-finish' ? -1 : 0;
    if (delta) opened.set(row.message_id, (opened.get(row.message_id) ?? 0) + delta);
  }
  if ([...opened.values()].some((value) => value > 0)) state.issues.add('native-step-unfinished');
  for (const row of rows) {
    if (state.clock() >= state.deadline) { state.issues.add('native-scan-budget'); return false; }
    if (row.kind !== 'step-finish') continue;
    if (!identifier(row.id) || !identifier(row.message_id) || row.session_id !== node.id) { state.issues.add('native-step-identity'); continue; }
    if (state.steps.length >= state.limits.maxSteps) { state.issues.add('native-step-budget'); return false; }
    state.steps.push(step(row, node.ancestors, state.issues));
  }
  return true;
}
function walk(db: Database, root: string, state: ScanState): void {
  const queue: ScanNode[] = [{ id: root, ancestors: [] }], visited = new Set<string>();
  while (queue.length) {
    if (state.clock() >= state.deadline) { state.issues.add('native-scan-budget'); return; }
    const node = queue.shift()!;
    if (visited.has(node.id)) { state.issues.add('native-tree-conflict'); continue; }
    if (state.sessions.length >= state.limits.maxSessions || node.ancestors.length > state.limits.maxDepth) { state.issues.add('native-tree-budget'); return; }
    visited.add(node.id); state.sessions.push(node);
    if (!readParts(db, node, state)) return;
    const remaining = Math.max(0, state.limits.maxSessions - state.sessions.length - queue.length);
    const children = db.query<Session, [string, number]>('SELECT id, parent_id FROM session WHERE parent_id=? ORDER BY id LIMIT ?').all(node.id, remaining + 1);
    if (children.length > remaining) { state.issues.add('native-tree-budget'); return; }
    for (const child of children) {
      if (!identifier(child.id) || child.parent_id !== node.id) { state.issues.add('native-tree-conflict'); continue; }
      queue.push({ id: child.id, ancestors: [...node.ancestors, node.id] });
    }
  }
}
/** Fixed upstream v1.18.29 native database; independent from the CS PostgreSQL ledger. */
export function readNativeUsageSnapshot(path: string | null, root: string, options: NativeScanOptions = {}): NativeUsageSnapshot {
  const clock = options.clock ?? (() => performance.now());
  const bound = (value: number | undefined, fallback: number, maximum: number) => Math.max(0, Math.min(maximum, Math.floor(value ?? fallback)));
  const state: ScanState = { steps: [], sessions: [], issues: new Set(), parts: 0, clock, deadline: clock() + bound(options.budgetMs, 400, 2000),
    limits: { maxSessions: bound(options.maxSessions, 128, 1024), maxSteps: bound(options.maxSteps, 5000, 10000), maxParts: bound(options.maxParts, 20000, 50000), maxDepth: bound(options.maxDepth, 32, 64) } };
  let db: Database | undefined;
  try {
    if (!path || !identifier(root)) throw new Error('Native store unavailable');
    db = new Database(path, { readonly: true }); db.exec('PRAGMA busy_timeout = 0'); db.exec('BEGIN');
    if (!db.query<Session, [string]>('SELECT id, parent_id FROM session WHERE id=?').get(root)) state.issues.add('native-root-unavailable');
    else walk(db, root, state);
    db.exec('COMMIT');
  } catch { state.issues.add('native-store-unavailable'); }
  finally { try { db?.close(); } catch { /* Native reader failures never change the Agent outcome. */ } }
  const metadata = new Set(['native-token-bucket-unknown', 'native-model-unavailable', 'native-time-unavailable']);
  return { steps: state.steps, sessions: state.sessions.length, issues: [...state.issues],
    fingerprint: [...state.issues].every((issue) => metadata.has(issue)) ? jsonHash([state.sessions, state.steps]) : null };
}
