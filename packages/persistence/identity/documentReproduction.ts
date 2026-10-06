import { identityValues, matchesIdentityCondition, referenceKeys, setIdentityFields, transformIdentityDocument } from './documentTransform';
import { ResourceIdentityMap } from './identityMap';
import type { IdentityDocument } from './model';

/** Re-derives a frozen document using existing aliases only. No allocation, binding, SQL write, or inferred identity. */
export async function reproduceIdentityDocument(document: unknown, declaration: IdentityDocument, row: Record<string, unknown>, resolve: (kind: string, keys: readonly string[]) => Promise<string | undefined>): Promise<unknown> {
  const identities = new ResourceIdentityMap();
  for (const reference of declaration.references) {
    if (!matchesIdentityCondition(row, reference.where)) continue;
    if (reference.stepTemplate || reference.serializedPath) throw new Error('Unsupported reproduction reference');
    for (const match of identityValues(document, reference.path)) {
      if (!matchesIdentityCondition(match.parent, reference.when) || reference.nullable && (match.value === null || match.value === undefined)
        || reference.selector && match.value === reference.selector.defaultValue) continue;
      const keys = referenceKeys(reference, match, row), id = await resolve(reference.kind, keys);
      if (!id) throw new Error('Original migration alias is unavailable: ' + reference.kind);
      identities.add({ kind: reference.kind, key: JSON.stringify(keys), id });
    }
  }
  const reproduced = transformIdentityDocument(document, declaration.references, row, identities, declaration.renames);
  setIdentityFields(reproduced, declaration.set);
  return reproduced;
}
