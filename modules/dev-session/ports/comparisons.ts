import type { ComparisonReference } from '../domain/comparisonReference';

export interface ComparisonReferences {
  create(reference: Omit<ComparisonReference, 'id'>): Promise<string>;
  get(id: string): Promise<ComparisonReference | undefined>;
}
