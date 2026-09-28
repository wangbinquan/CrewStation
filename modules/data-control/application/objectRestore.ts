import { conflict, notFound, precondition } from '@crewstation/kernel';
import type { ObjectEndpointConfig, ObjectEndpointStore, StoredObjectEndpoint } from '../ports/objectPlane';
import type { SecretCipher } from '../ports/credentials';

export function prepareObjectRestore(deps: { store: ObjectEndpointStore; within(transaction: object): ObjectEndpointStore; cipher: SecretCipher; probe(config: ObjectEndpointConfig, signal: AbortSignal): Promise<void> }) {
  return async (input: readonly (ObjectEndpointConfig & { backendId: string; sourceRevision: number; targetRevision: number })[], signal: AbortSignal) => {
    const records: StoredObjectEndpoint[] = [];
    for (const item of input) {
      const source = await deps.store.get(item.backendId, item.sourceRevision);
      if (!source) throw notFound('原对象后端位置');
      if (source.endpoint.replace(/\/$/, '') === item.endpoint.replace(/\/$/, '') && source.bucket === item.bucket) throw precondition('恢复目标不能仍指向原对象桶');
      if (item.targetRevision <= item.sourceRevision) throw conflict('恢复必须创建新位置修订');
      try { await deps.probe(item, signal); } catch { throw precondition('恢复目标不可访问'); }
      records.push({ backendId: item.backendId, placementRevision: item.targetRevision, credentialRevision: 1, endpoint: item.endpoint, region: item.region, bucket: item.bucket,
        credentialsBox: await deps.cipher.encrypt(JSON.stringify({ accessKeyId: item.accessKeyId, secretAccessKey: item.secretAccessKey, ...(item.monitoring ? { monitoring: item.monitoring } : {}) })) });
    }
    return { commit: async (transaction: object) => {
      for (const record of records) {
        const saved = await deps.within(transaction).put(record);
        if (await deps.cipher.decrypt(saved.credentialsBox) !== await deps.cipher.decrypt(record.credentialsBox)) throw conflict('恢复目标的凭据已被其他操作修改');
      }
    } };
  };
}
