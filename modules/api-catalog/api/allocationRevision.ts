import type { ApiOperationDto } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';

export const apiAllocationRevision = (op: Pick<ApiOperationDto, 'id' | 'proxyId' | 'method' | 'path' | 'openPolicy'>, granted: boolean) => jsonHash({ id: op.id, proxyId: op.proxyId, method: op.method, path: op.path, openPolicy: op.openPolicy, granted });
