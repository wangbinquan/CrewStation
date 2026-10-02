import type { DevelopmentParentMaterials } from '../domain/development/parentMaterials';
import type { DevelopmentParentEnding } from './developmentParentEnding';
import type { DevelopmentRemovalDecision, DevelopmentRemovalTarget } from './cluster';

/** Real owner/cluster boundary; all methods run outside Task Project/Resource transactions. */
export interface DevelopmentParentPhysical {
  inspect(ending: DevelopmentParentEnding): Promise<DevelopmentParentMaterials>;
  fence(ending: DevelopmentParentEnding, materials: DevelopmentParentMaterials, current: () => Promise<void>): Promise<void>;
  requestStop(ending: DevelopmentParentEnding, materials: DevelopmentParentMaterials, current: () => Promise<void>): Promise<void>;
  removeSecrets(ending: DevelopmentParentEnding, materials: DevelopmentParentMaterials, current: () => Promise<void>): Promise<void>;
  /** No live object is silently substituted for the original UID; the retained PVC is always reread. */
  absent(ending: DevelopmentParentEnding, materials: DevelopmentParentMaterials): Promise<Readonly<Record<string, unknown>> | undefined>;
  removal(ending: DevelopmentParentEnding, materials: DevelopmentParentMaterials, target: DevelopmentRemovalTarget): Promise<DevelopmentRemovalDecision>;
}
