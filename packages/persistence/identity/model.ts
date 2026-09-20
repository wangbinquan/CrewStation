import type { Executor } from '../connection';

/** A checked-in data migration describes only its owner's tables and explicit reference paths. */
export type IdentityCondition = Readonly<Record<string, string | null | readonly string[]>>;
export interface IdentityEntity {
  readonly nullable?: boolean;
  readonly where?: IdentityCondition;
  readonly aliases?: readonly (readonly string[])[];
  readonly table: string;
  readonly kind: string;
  readonly keys: readonly string[];
  readonly idColumn: string;
}

export interface IdentityReference {
  readonly where?: IdentityCondition;
  readonly table: string;
  readonly column: string;
  readonly kind: string;
  /** Original row columns, in the same order as the target entity's keys. */
  readonly keys: readonly string[];
  readonly nullable?: boolean;
  readonly keyOverride?: { readonly when: string; readonly keys: readonly string[] };
}

export interface IdentityBinding {
  readonly table: string;
  readonly kind: string;
  readonly keys: readonly string[];
  readonly referenceKeys: readonly string[];
}

export interface IdentityDocumentReference {
  readonly where?: IdentityCondition;
  readonly when?: IdentityCondition;
  /** A declared field containing JSON text, such as a frozen slot revision. */
  readonly serializedPath?: string;
  /** Dotted JSON path; * traverses array elements or object values. */
  readonly path: string;
  readonly kind: string;
  /** $value, $row.column, or a path relative to the matched value's parent. */
  readonly keys?: readonly string[];
  readonly rename?: string;
  readonly nullable?: boolean;
  /** Converts a legacy protocol symbol to a declaration with a UUID and its original symbol. */
  readonly declaration?: boolean;
  /** Rewrites only recognized {{steps.ID.*}} references in a declared template field. */
  readonly stepTemplate?: boolean;
  /** Keep the original protocol symbol while writing a separate identity property. */
  readonly copyTo?: string;
  readonly selector?: { defaultValue: string; valueKey: string };
  /** Replace a legacy tuple with an object carrying its canonical identity. */
  readonly objectKey?: string;
}

export interface IdentityDocument {
  readonly where?: IdentityCondition;
  readonly set?: readonly { path: string; value: unknown }[];
  readonly provenanceColumn?: string;
  readonly table: string;
  readonly column: string;
  /** Immutable originals can be retained while their normalized projection is written here. */
  readonly targetColumn?: string;
  readonly references: readonly IdentityDocumentReference[];
  readonly renames?: readonly { path: string; rename: string }[];
}

export interface IdentityInlineEntity extends IdentityDocumentReference {
  readonly where?: IdentityCondition;
  readonly table: string;
  readonly column: string;
}

export interface ResourceIdentityMigration {
  readonly version: 'resource-identity/v1';
  readonly schema: string;
  readonly entities: readonly IdentityEntity[];
  readonly references: readonly IdentityReference[];
  readonly documents?: readonly IdentityDocument[];
  readonly inlineEntities?: readonly IdentityInlineEntity[];
  readonly seeds?: readonly { kind: string; keys: readonly string[]; id: string }[];
  readonly finalize?: readonly string[];
  /** Declarations are read by their source owner, then materialized only by the owning import participant. */
  readonly declarations?: readonly (IdentityInlineEntity & { fields: Readonly<Record<string, string>> })[];
  readonly imports?: readonly IdentityEntity[];
  /** Owner-published reference bindings, resolved after all resource identities exist. */
  readonly bindings?: readonly IdentityBinding[];
}

export interface IdentityAlias {
  readonly kind: string;
  readonly key: string;
  readonly id: string;
}

export interface PreparedIdentityMigration {
  readonly definition: ResourceIdentityMigration;
  readonly aliases: readonly IdentityAlias[];
}

export type IdentityExecutor = Executor;
