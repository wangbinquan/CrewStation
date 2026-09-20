import type { IdentityCondition, IdentityDocumentReference } from './model';
import type { ResourceIdentityMap } from './identityMap';

type JsonObject = Record<string, unknown>;
export interface IdentityValue { readonly value: unknown; readonly parent: JsonObject; readonly field: string }

function object(value: unknown): value is JsonObject { return value !== null && typeof value === 'object'; }

/** Traverses declared fields only; application payloads, scripts and log text are never searched. */
export function identityValues(document: unknown, path: string): IdentityValue[] {
  const segments = path.startsWith('/') ? path.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~')) : path.split('.');
  const walk = (value: unknown, index: number): IdentityValue[] => {
    if (!object(value)) return [];
    const segment = segments[index]!;
    const fields = segment === '*' ? Object.keys(value) : Object.hasOwn(value, segment) ? [segment] : [];
    return fields.flatMap((field) => index === segments.length - 1
      ? [{ parent: value, field, value: value[field] }]
      : walk(value[field], index + 1));
  };
  return walk(document, 0);
}

export function matchesIdentityCondition(row: JsonObject, where?: IdentityCondition): boolean {
  return !where || Object.entries(where).every(([key, expected]) => Array.isArray(expected) ? expected.includes(String(row[key])) : (row[key] ?? null) === expected);
}

export function referenceValue(key: string, match: IdentityValue, row: JsonObject): unknown {
  for (const candidate of key.split('|')) {
    const [root, path] = candidate === '$value' ? [match.value, ''] : candidate.startsWith('$value.') ? [match.value, candidate.slice(7)]
      : candidate.startsWith('$row.') ? [row, candidate.slice(5)] : [match.parent, candidate];
    const value = path ? path.split('.').reduce<unknown>((current, part) => object(current) ? current[part] : undefined, root) : root;
    if (value !== null && value !== undefined) return value;
  }
  return undefined;
}

export function referenceKeys(ref: IdentityDocumentReference, match: IdentityValue, row: JsonObject): string[] {
  return (ref.keys ?? ['$value']).map((key) => {
    const value = referenceValue(key, match, row);
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
    if (typeof value !== 'string') throw new Error(`Identity reference ${ref.path}: ${key} must be a string`);
    return value;
  });
}

export function transformIdentityDocument(document: unknown, references: readonly IdentityDocumentReference[], row: JsonObject, identities: ResourceIdentityMap, renames: readonly { path: string; rename: string }[] = [], context?: string): unknown {
  const result = structuredClone(document);
  // Resolve every reference against the original document before renaming/removing any scope fields.
  const updates = references.flatMap((ref) => {
    if (!matchesIdentityCondition(row, ref.where)) return [];
    const targets = identityValues(result, ref.path);
    return identityValues(document, ref.path).flatMap<{ ref: IdentityDocumentReference; target: IdentityValue; id: string | undefined }>((match, index) => {
      if (!matchesIdentityCondition(match.parent, ref.when)) return [];
      if (ref.nullable && (match.value === null || match.value === undefined)) return [];
      const target = targets[index]!;
      if (ref.selector && match.value === ref.selector.defaultValue) return [{ ref, target, id: undefined }];
      if (ref.stepTemplate && typeof match.value !== 'string') throw new Error(`Identity template ${ref.path} must be a string`);
      const id = ref.serializedPath
        ? JSON.stringify(transformIdentityDocument(JSON.parse(String(match.value)), [{ path: ref.serializedPath, kind: ref.kind, nullable: ref.nullable }], row, identities))
        : ref.stepTemplate
        ? String(match.value).replace(/(\{\{\s*steps\.)([A-Za-z0-9_-]+)(\.)/g, (_original, prefix: string, oldId: string, suffix: string) => `${prefix}${identities.resolve(ref.kind, referenceKeys(ref, { ...match, value: oldId }, row))}${suffix}`)
        : identities.resolve(ref.kind, referenceKeys(ref, match, row), `${context ?? 'document'}.${ref.path}`);
      return [{ ref, target, id }];
    });
  });
  for (const { ref, target, id } of updates) {
    target.parent[ref.copyTo ?? ref.rename ?? target.field] = ref.selector ? (id === undefined ? { kind: 'default' } : { kind: 'profile', [ref.selector.valueKey]: id })
      : ref.objectKey ? { [ref.objectKey]: id } : ref.declaration ? { id, name: target.value } : id;
    if (ref.rename && ref.rename !== target.field) delete target.parent[target.field];
  }
  for (const change of renames) for (const target of identityValues(result, change.path)) {
    target.parent[change.rename] = target.value;
    if (change.rename !== target.field) delete target.parent[target.field];
  }
  return result;
}

export function setIdentityFields(document: unknown, fields: readonly { path: string; value: unknown }[] = []): void {
  for (const field of fields) {
    const segments = field.path.split('.'), name = segments.pop()!;
    const targets = segments.length ? identityValues({ root: document }, ['root', ...segments].join('.')).map((entry) => entry.value) : [document];
    for (const target of targets) if (object(target)) target[name] = structuredClone(field.value);
  }
}
