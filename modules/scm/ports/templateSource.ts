import type { ConfigDefinitionDto, ProjectId, ProjectTemplateDto, ServiceId } from '@crewstation/contracts';

export interface TemplateResourceContext { projectId: ProjectId; serviceId: ServiceId }
export interface TemplateResourceBindings {
  allocate(kind: 'config-definition' | 'agent-profile' | 'output-contract', context: TemplateResourceContext, templateId: string, slotId: string): Promise<string>;
  ensureDefinition(projectId: ProjectId, definition: ConfigDefinitionDto): Promise<void>;
  eventType(producerCode: string, eventCode: string): Promise<string | undefined>;
}

/** 列出实际可用模板并复制内容；模板名不存在时抛 not_found。 */
export interface TemplateSource {
  list(): Promise<ProjectTemplateDto[]>;
  materialize(templateId: string, targetDir: string, initialPlan?: string, context?: TemplateResourceContext): Promise<void>;
}
