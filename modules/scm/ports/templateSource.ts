import type { ProjectTemplateDto } from '@crewstation/contracts';

/** 列出实际可用模板并复制内容；模板名不存在时抛 not_found。 */
export interface TemplateSource {
  list(): Promise<ProjectTemplateDto[]>;
  materialize(templateName: string, targetDir: string, initialPlan?: string): Promise<void>;
}
