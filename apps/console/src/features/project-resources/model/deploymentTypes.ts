import type { ProjectResourceNode } from '@crewstation/contracts';
import type { Topology, TopologyEdge, TopologyNode } from '../../../shared/ui/topology/topologyModel';

export const DEPLOYMENT_VIEWS = ['services', 'development', 'business', 'delivery'] as const;
export type DeploymentView = typeof DEPLOYMENT_VIEWS[number];
export interface DeploymentObject { node: TopologyNode; members: TopologyNode[]; anchors: string[]; permissions: ProjectResourceNode[]; views: Set<DeploymentView>; namespace: boolean }
export interface DeploymentRelation extends TopologyEdge { sourceId: string; targetId: string }
export interface DeploymentGraph { objects: Map<string, DeploymentObject>; relations: DeploymentRelation[]; original: Topology; usedIds: Set<string>; unmapped: TopologyNode[] }
