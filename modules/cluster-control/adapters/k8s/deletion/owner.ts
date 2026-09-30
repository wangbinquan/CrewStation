import type { ProjectDeletionContext } from '@crewstation/contracts';
import type { K8sClient } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { conflict, precondition } from '@crewstation/kernel';
import { originalUid } from '../../../domain/deletion/objects';
import type { LedgerObservations } from '../../../ports/ledger';
import type { ProjectClusterDeletion } from '../../../ports/projectDeletion';
import type { ClusterDeletionAdmission } from '../../../api/projectDeletion';
import { removeRetiredNamespace } from '../namespaceRetirement';
import { inspectProjectCluster } from './inspection';

export function clusterDeletionSource(k8s: K8sClient, ledger: Pick<LedgerObservations, 'claimOf' | 'get'>, systemNamespace: string, admission: ClusterDeletionAdmission): ProjectClusterDeletion {
  return {
    inspect: (target) => inspectProjectCluster(k8s, ledger, admission, target, systemNamespace),
    removeNamespace: async (context: ProjectDeletionContext, uid: string) => {
      const children = context.confirmed.resources.filter((entry) => ['Service', 'ResourceQuota', 'NetworkPolicy'].includes(entry.kind)).map((entry) => {
        const value = JSON.parse(entry.id) as { namespace?: string; name?: string };
        if (!value.name || value.namespace !== context.target.namespace) throw precondition('原命名空间子对象身份不完整');
        return { kind: entry.kind, namespace: value.namespace, name: value.name, uid: originalUid(entry) };
      });
      await admission.assertSealed(context); await admission.assertGrant(context);
      await removeRetiredNamespace(k8s, context.target.namespace, { uid, children }, systemNamespace, AbortSignal.timeout(30_000));
      const current = await k8s.get(Resources.Namespace!, context.target.namespace, undefined, AbortSignal.timeout(15_000));
      if (current && current.metadata.uid !== uid) throw conflict('原命名空间已被同名新实例替换');
      return !current;
    },
  };
}
