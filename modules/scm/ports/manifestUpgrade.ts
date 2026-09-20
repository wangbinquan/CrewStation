import type { ManifestUpgradePreview } from '@crewstation/contracts';
import type { TemplateResourceContext } from './templateSource';

/** Explicit v1 import boundary. Preview allocates stable identities but never writes a source file. */
export interface ManifestUpgrade {
  preview(content: string, context: TemplateResourceContext): Promise<ManifestUpgradePreview>;
}
