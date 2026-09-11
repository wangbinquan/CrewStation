import type { MemberDto, ProjectDto, ServiceDto } from '@crewstation/contracts';
import type { Project } from '../domain/project';
import type { Service } from '../domain/service';
import type { HostNaming } from '../ports/hostNaming';
import type { Membership } from '../ports/repositories';

export function projectToDto(project: Project, service: Service | undefined): ProjectDto {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    kind: project.kind,
    namespace: project.namespace,
    ownerUserId: project.ownerUserId,
    state: project.state,
    ...(service ? { serviceId: service.id } : {}),
    ...(project.message ? { message: project.message } : {}),
    createdAt: project.createdAt.toISOString(),
  };
}

export function serviceToDto(service: Service, project: Project, hosts: HostNaming): ServiceDto {
  return {
    id: service.id,
    projectId: service.projectId,
    name: service.name,
    kind: service.kind,
    identity: service.identity,
    prodHost: hosts.prodHost(project.slug),
    previewHost: hosts.previewHost(project.slug),
    serviceHost: hosts.serviceHost(project.slug),
  };
}

export function memberToDto(membership: Membership, user: { name: string; email: string } | undefined): MemberDto {
  return { userId: membership.userId, role: membership.role, name: user?.name ?? '', email: user?.email ?? '' };
}
