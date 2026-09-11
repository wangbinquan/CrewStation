import { ManifestSchema } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import type { ManifestParser } from '../../ports/platform';

export const yamlManifestParser: ManifestParser = {
  parse: (text) => {
    const parsed = ManifestSchema.safeParse(Bun.YAML.parse(text));
    if (!parsed.success) throw validation(`crewstation.yaml 无效：${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；')}`);
    return parsed.data;
  },
};
