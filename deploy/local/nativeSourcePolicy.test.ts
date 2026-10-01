import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('native source planning and controller cleanup can reach the authenticated probe through exact platform roles', () => {
  const documents = readFileSync(resolve(import.meta.dir, '../k8s/platform/38-cluster-metrics.yaml'), 'utf8').split(/^---\s*$/m).map((text) => Bun.YAML.parse(text) as { kind?: string; metadata?: { name?: string }; spec?: { ingress?: Array<{ from?: Array<{ podSelector?: { matchLabels?: Record<string, string> }; namespaceSelector?: unknown; ipBlock?: unknown }>; ports?: Array<{ port?: number; protocol?: string }> }> } });
  const policy = documents.find((document) => document.kind === 'NetworkPolicy' && document.metadata?.name === 'crewstation-storage-probe');
  const ingress = policy?.spec?.ingress;
  expect(ingress).toHaveLength(1); expect(ingress![0]!.ports).toEqual([{ protocol: 'TCP', port: 8095 }]);
  const sources = ingress![0]!.from!;
  expect(sources.every((source) => !source.namespaceSelector && !source.ipBlock)).toBe(true);
  expect(sources.map((source) => source.podSelector?.matchLabels?.['app.kubernetes.io/name']).sort()).toEqual(['cs-api', 'cs-controller']);
});
