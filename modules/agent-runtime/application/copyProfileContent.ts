import type { ComputeProfileContent } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import type { ProfileCredential } from '../domain/computeProfile';

/** Copy creates new child resources; only parsed step template references are redirected. */
export function copyProfileContent(content: ComputeProfileContent, stored: readonly ProfileCredential[]): { content: ComputeProfileContent; credentials: ProfileCredential[] } {
  const steps = new Map(content.steps.map((step) => [step.stepId, newResourceId()]));
  const secrets = new Map(content.secrets.map((secret) => [secret.id, newResourceId()]));
  const template = (value: string): string => value.replace(/(\{\{\s*steps\.)([A-Za-z0-9_-]+)(\.)/g, (original, prefix: string, id: string, suffix: string) => steps.has(id) ? `${prefix}${steps.get(id)}${suffix}` : original);
  return {
    content: { ...content, secrets: content.secrets.map((secret) => ({ ...secret, id: secrets.get(secret.id)! })),
      steps: content.steps.map((step) => step.kind === 'file'
        ? { ...step, stepId: steps.get(step.stepId)!, pathTemplate: template(step.pathTemplate), contentTemplate: template(step.contentTemplate) }
        : { ...step, stepId: steps.get(step.stepId)!, source: template(step.source), ...(step.cwdTemplate ? { cwdTemplate: template(step.cwdTemplate) } : {}), argv: step.argv.map(template) }),
      configFile: content.configFile.kind === 'none' ? content.configFile : { ...content.configFile, pathTemplate: template(content.configFile.pathTemplate) },
    },
    credentials: stored.filter((credential) => secrets.has(credential.id)).map((credential) => ({ ...credential, id: secrets.get(credential.id)! })),
  };
}
