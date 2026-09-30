import { BUILTIN_RESOURCES } from '@crewstation/contracts';
import type { ProjectTemplateDto } from '@crewstation/contracts';
import type { Translate } from '../../../shared/lib/useT';

const DESCRIPTIONS: Readonly<Record<string, string>> = {
  [BUILTIN_RESOURCES.minimalTemplate]: 'basic',
  '01a0e222-de8b-7000-8cd8-207c8673b62e': 'execution',
  [BUILTIN_RESOURCES.proxyTemplate]: 'proxy',
  [BUILTIN_RESOURCES.eventTemplate]: 'gitlab',
  '01a0bf5d-8f4b-7004-9cf7-0eb8bf66ffbd': 'github',
};

/** 说明绑定不可变模板身份；未知模板只陈述复制初始代码的通用行为。 */
export function templateDescription(template: ProjectTemplateDto, t: Translate) {
  const key = DESCRIPTIONS[template.id];
  return { name: key ? t(`projects.creation.template.${key}.name`) : template.name,
    description: t(`projects.creation.template.${key ?? 'other'}.description`),
    contents: key ? t(`projects.creation.template.${key}.contents`) : undefined };
}
