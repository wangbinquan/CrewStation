import { ManifestSchema, describeManifestFailure } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import type { ManifestParser } from '../../ports/platform';

export const yamlManifestParser: ManifestParser = {
  parse: (text) => {
    const parsed = ManifestSchema.safeParse(Bun.YAML.parse(text));
    if (!parsed.success) throw validation(`crewstation.yaml 无效：${describeManifestFailure(parsed.error)}`);
    return parsed.data;
  },
};
