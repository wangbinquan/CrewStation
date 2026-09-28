import { conflict, notFound, precondition } from '@crewstation/kernel';
import type { SecretCipher } from '../ports/credentials';
import type { ObjectEndpointConfig, ObjectEndpointStore } from '../ports/objectPlane';

export interface ObjectRotationCandidate {
  readonly backendId: string; readonly placementRevision: number; readonly credentialRevision: number;
  readonly accessKeyId: string; readonly secretAccessKey: string; readonly monitoringToken?: string;
}
/** Validate outside the metadata transaction; its commit closure only swaps an encrypted PG record. */
export function prepareObjectCredentialRotation(deps: { store: ObjectEndpointStore; within(transaction: object): ObjectEndpointStore; cipher: SecretCipher; probe(config: ObjectEndpointConfig, signal: AbortSignal): Promise<void> }) {
  return async (input: ObjectRotationCandidate, signal: AbortSignal): Promise<{ commit(transaction: object): Promise<void> }> => {
    const original = await deps.store.get(input.backendId, input.placementRevision);
    if (!original) throw notFound('对象后端位置');
    if (original.credentialRevision !== input.credentialRevision) throw conflict('对象凭据修订已变化');
    const old = JSON.parse(await deps.cipher.decrypt(original.credentialsBox)) as Pick<ObjectEndpointConfig, 'accessKeyId' | 'secretAccessKey' | 'monitoring'>;
    if (input.monitoringToken && !old.monitoring) throw precondition('未配置观测端点，不能单独轮换观测令牌');
    const credentials = { ...old, accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey, ...(input.monitoringToken ? { monitoring: { ...old.monitoring!, token: input.monitoringToken } } : {}) };
    try { await deps.probe({ endpoint: original.endpoint, region: original.region, bucket: original.bucket, ...credentials }, signal); }
    catch { throw precondition('新凭据不能访问原对象桶，未切换凭据', { code: 'object_credentials_unverified' }); }
    const record = { ...original, credentialRevision: original.credentialRevision + 1, credentialsBox: await deps.cipher.encrypt(JSON.stringify(credentials)) };
    return { commit: async (transaction) => {
      const saved = await deps.within(transaction).put(record);
      if (saved.credentialsBox !== record.credentialsBox) throw conflict('对象凭据已由另一轮换更新');
    } };
  };
}
