import { buildKitHistory, buildKitUsage, buildKitVersion } from './controlRecords';
import { protoBytes, protoFields, protoMessage, protoText } from './protobuf';
import type { BuildKitControlTransport } from './controlTransport';
import { buildKitHistoryOwnership } from './history/ownership';
import type { BuildKitHistoryQuery } from './history/ownership';

function unary(messages: readonly Uint8Array[]) {
  if (messages.length !== 1) throw Error('Original native BuildKit unary response is incomplete or repeated');
  return protoFields(messages[0]!);
}
function repeated(fields: ReturnType<typeof protoFields>, number: number) {
  const records = fields.filter(row => row.number === number);
  if (records.some(row => row.wire !== 2)) throw Error('Original native BuildKit repeated message wire type is invalid');
  return records.map(row => row.value as Uint8Array);
}
/** The read surface always consumes a successful native EOF. No history
 * limit/filter or caller-produced inventory can stand in for a full scan. */
export function createBuildKitControlClient(rpc: BuildKitControlTransport) {
  return {
    info: async (signal?: AbortSignal) => buildKitVersion(protoBytes(unary(await rpc('Info', new Uint8Array(), signal)), 1, true)!),
    workers: async (signal?: AbortSignal) => {
      const records = repeated(unary(await rpc('ListWorkers', new Uint8Array(), signal)), 1).map(raw => {
        const fields = protoFields(raw), id = protoText(fields, 1, true);
        if (!/^[a-z0-9]{20,40}$/.test(id ?? '')) throw Error('Original native BuildKit worker identity is invalid');
        return { id: id!, ...buildKitVersion(protoBytes(fields, 5, true)!) };
      });
      if (!records.length || new Set(records.map(row => row.id)).size !== records.length) throw Error('Original native BuildKit worker scope is empty or repeated');
      return records.sort((a, b) => a.id.localeCompare(b.id));
    },
    diskUsage: async (signal?: AbortSignal) => {
      const records = repeated(unary(await rpc('DiskUsage', new Uint8Array(), signal)), 1).map(buildKitUsage);
      if (new Set(records.map(row => row.id)).size !== records.length) throw Error('Original native BuildKit cache identity is repeated');
      return records.sort((a, b) => a.id.localeCompare(b.id));
    },
    history: async (signal?: AbortSignal) => {
      const records = (await rpc('ListenBuildHistory', protoMessage([{ number: 3, value: 1n }]), signal)).map(buildKitHistory);
      if (new Set(records.map(row => row.ref)).size !== records.length || records.some(row => row.event === 'deleted')) throw Error('Original native BuildKit history scope changed during EOF');
      return records.sort((a, b) => a.ref.localeCompare(b.ref));
    },
    historyOwnership: async (query: BuildKitHistoryQuery, signal?: AbortSignal) => {
      const records = (await rpc('ListenBuildHistory', protoMessage([{ number: 3, value: 1n }]), signal)).map(raw => buildKitHistoryOwnership(raw, query));
      if (new Set(records.map(row => row.history.ref)).size !== records.length || records.some(row => row.history.event === 'deleted')) throw Error('Original native BuildKit ownership history changed during EOF');
      return records.sort((a, b) => a.history.ref.localeCompare(b.history.ref));
    },
  };
}
