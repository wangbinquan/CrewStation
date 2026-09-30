import { Database } from 'bun:sqlite';
import { isAbsolute, join } from 'node:path';
import { identifier, object, type UsageNormalizer, type UsageObject } from './capture';
import { normalizeOpencodeUsage } from './opencode';
import type { RunnerUsageMeasurement } from '@crewstation/contracts';
import type { DevelopmentNativeObserver } from './developmentNativeObserver';

type ActualModel = NonNullable<RunnerUsageMeasurement['actualModel']>;
/** v1.18.29 core/database/database.ts: explicit DB overrides the standard release channel path. */
export function opencodeUsageDatabasePath(env: Readonly<Record<string, string | undefined>>): string | null {
  const explicit = env.OPENCODE_DB;
  if (explicit === ':memory:') return null;
  if (explicit && isAbsolute(explicit)) return explicit;
  const data = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME
    : env.HOME && isAbsolute(env.HOME) ? join(env.HOME, '.local', 'share') : null;
  return data ? join(data, 'opencode', explicit || 'opencode.db') : null;
}

/** Only an observed step's exact native message may supply the actual route. */
export function readOpencodeUsageModel(path: string | null, raw: UsageObject, session: string): ActualModel | null {
  const part = object(raw.part), id = identifier(part?.id), message = identifier(part?.messageID);
  if (!path || !id || !message || raw.sessionID !== session || part?.sessionID !== session) return null;
  let db: Database | undefined;
  try {
    db = new Database(path, { readonly: true });
    db.exec('PRAGMA busy_timeout = 0');
    const row = db.query<{ data: string; part: string }, [string, string, string]>(
      'SELECT m.data AS data, p.data AS part FROM part p JOIN message m ON m.id=p.message_id AND m.session_id=p.session_id WHERE p.id=? AND p.session_id=? AND m.id=?',
    ).get(id, session, message);
    if (!row || object(JSON.parse(row.part))?.type !== 'step-finish') return null;
    const info = object(JSON.parse(row.data)), provider = identifier(info?.providerID), model = identifier(info?.modelID);
    if (info?.role !== 'assistant' || !provider || !model || provider.length > 200 || model.length > 300) return null;
    return { provider, model, condition: null };
  } catch { return null; }
  finally { try { db?.close(); } catch { /* No persistent reader is retained. */ } }
}

/** Private to one prepared Agent. Retain proven metadata when a later native read is unavailable. */
export function createOpencodeUsageNormalizer(env: Readonly<Record<string, string | undefined>>): UsageNormalizer {
  const path = opencodeUsageDatabasePath(env), proven = new Map<string, ActualModel>();
  return (raw, context, diagnostics) => {
    const rows = normalizeOpencodeUsage(raw, context, diagnostics);
    if (!rows.length) return rows;
    const key = JSON.stringify([context.sessionId, object(raw.part)?.id, object(raw.part)?.messageID]);
    const actual = readOpencodeUsageModel(path, raw, context.sessionId) ?? proven.get(key) ?? null;
    if (actual) { if (!proven.has(key)) proven.set(key, actual); }
    else diagnostics.push('native-model-unavailable');
    return rows.map((row) => ({ ...row, actualModel: actual }));
  };
}

/** Development never borrows metadata from a replaced or currently unverified store. */
export function createDevelopmentOpencodeUsageNormalizer(observer: DevelopmentNativeObserver): UsageNormalizer {
  const proven = new Map<string, ActualModel>();
  return (raw, context, diagnostics) => {
    const rows = normalizeOpencodeUsage(raw, context, diagnostics);
    if (!rows.length) return rows;
    const observed = observer.read((path) => readOpencodeUsageModel(path, raw, context.sessionId));
    const bound = observed.store.state === 'observed' && !observer.changed();
    const key = bound ? JSON.stringify([observed.store, context.sessionId, object(raw.part)?.id, object(raw.part)?.messageID]) : null;
    if (!bound) proven.clear();
    const actual = key ? observed.value ?? proven.get(key) ?? null : null;
    if (actual && key) proven.set(key, actual);
    else diagnostics.push('native-model-unavailable');
    return rows.map((row) => ({ ...row, actualModel: actual }));
  };
}
