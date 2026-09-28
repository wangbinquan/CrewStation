import { conflict, notFound } from '@crewstation/kernel';
import type { SecretCipher } from '../ports/credentials';
import type { ObjectEndpointConfig, ObjectEndpointStore, ObjectLocation, ObjectPhysicalObservation } from '../ports/objectPlane';

// The I/O transport is injected by wiring; application does not select a backend or fetch directly.
export interface ObjectEndpointDependencies { store: ObjectEndpointStore; cipher: SecretCipher; probe(config: ObjectEndpointConfig, signal: AbortSignal): Promise<void>; observePhysical?(config: NonNullable<ObjectEndpointConfig['monitoring']>, signal: AbortSignal): Promise<ObjectPhysicalObservation> }
export function objectEndpointUseCases(deps: ObjectEndpointDependencies) {
  const resolve = async (location: Pick<ObjectLocation, 'backendId' | 'placementRevision'>): Promise<ObjectEndpointConfig> => {
    const record = await deps.store.get(location.backendId, location.placementRevision);
    if (!record) throw notFound('对象后端位置');
    const credential = JSON.parse(await deps.cipher.decrypt(record.credentialsBox)) as Pick<ObjectEndpointConfig, 'accessKeyId' | 'secretAccessKey' | 'monitoring'>;
    return { endpoint: record.endpoint, region: record.region, bucket: record.bucket, ...credential };
  };
  return {
    resolve,
    configure: async (id: string, placementRevision: number, credentialRevision: number, config: ObjectEndpointConfig) => {
      const credentialsBox = await deps.cipher.encrypt(JSON.stringify({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, ...(config.monitoring ? { monitoring: config.monitoring } : {}) }));
      const saved = await deps.store.put({ backendId: id, placementRevision, credentialRevision, endpoint: config.endpoint, region: config.region, bucket: config.bucket, credentialsBox });
      const actual = JSON.parse(await deps.cipher.decrypt(saved.credentialsBox)) as Pick<ObjectEndpointConfig, 'accessKeyId' | 'secretAccessKey' | 'monitoring'>;
      if (actual.accessKeyId !== config.accessKeyId || actual.secretAccessKey !== config.secretAccessKey || JSON.stringify(actual.monitoring) !== JSON.stringify(config.monitoring)) throw conflict('同一凭据修订不能提交不同内容');
    },
    probe: async (backendId: string, placementRevision: number, signal: AbortSignal) => {
      const record = await deps.store.get(backendId, placementRevision);
      if (!record) throw notFound('对象后端位置');
      const config = await resolve({ backendId, placementRevision });
      try {
        await deps.probe(config, signal);
        const physical = config.monitoring && deps.observePhysical ? await deps.observePhysical(config.monitoring, signal).catch(() => ({ freeBytes: null, totalBytes: null, physicalObservedAt: null, health: 'ready' as const })) : undefined;
        return { backendId, placementRevision, credentialRevision: record.credentialRevision, health: 'ready' as const, message: physical?.physicalObservedAt === null ? '物理容量观测不可用' : null, observedAt: new Date().toISOString(), ...physical };
      }
      catch { return { backendId, placementRevision, credentialRevision: record.credentialRevision, health: 'unavailable' as const, message: '对象后端探测失败，请检查连通性和凭据', observedAt: new Date().toISOString() }; }
    },
  };
}
