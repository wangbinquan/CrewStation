import { z } from 'zod';
import { BusinessTaskDtoSchema, CreateBusinessTaskRequestSchema, SubmitSubtaskRequestSchema, SubtaskDtoSchema, SubtaskMessageRequestSchema } from '../api/businessTask';
import { HOST_PATTERNS, IDENTITY_HEADERS, PLATFORM_ENV, PLATFORM_PATHS, PLATFORM_SERVICE_HOSTS, TOKEN_CLAIMS } from '../convention';
import { EVENT_HEADERS, EventDeliverySchema, ProducedEventSchema } from '../events/delivery';
import { ManifestSchema } from '../manifest/manifest';
import { TASKRUNNER_PROTOCOL_VERSION } from '../taskrunner/protocol';

/**
 * 业务契约面：已经部署的数字人、接入容器与业务仓库的 `crewstation.yaml` 依赖、而平台单方面改动就会弄坏它们的那部分契约。
 * 范围与分类规则见 docs/engineering/testing.md §6。工作台、CLI 与 MCP 自己消费的接口随平台一起发布，不在此列。
 */
export type SurfaceDirection = 'business-to-platform' | 'platform-to-business';
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface ContractSurface {
  /** 业务代码按名字依赖的常量：请求头、环境变量、路径、令牌声明、域名模式。 */
  readonly constants: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly schemas: Readonly<Record<string, { readonly direction: SurfaceDirection; readonly schema: JsonValue }>>;
}

/** 业务发给平台的按输入形状取（默认值可省略），平台发给业务的按输出形状取（默认值已补齐）。 */
export function surfaceSchema(schema: z.ZodType, direction: SurfaceDirection): { readonly direction: SurfaceDirection; readonly schema: JsonValue } {
  const io = direction === 'business-to-platform' ? 'input' : 'output';
  return { direction, schema: normalize(z.toJSONSchema(schema, { io }) as JsonValue) };
}
const sent = (schema: z.ZodType) => surfaceSchema(schema, 'business-to-platform');
const received = (schema: z.ZodType) => surfaceSchema(schema, 'platform-to-business');

export function buildContractSurface(): ContractSurface {
  return {
    constants: {
      IDENTITY_HEADERS, PLATFORM_ENV, PLATFORM_PATHS, TOKEN_CLAIMS, HOST_PATTERNS, PLATFORM_SERVICE_HOSTS, EVENT_HEADERS,
      // 协议号一变，所有在跑的任务容器都会在握手时被拒（RFC-008 的背景事故），所以它也算契约面。
      TASKRUNNER: { protocolVersion: String(TASKRUNNER_PROTOCOL_VERSION) },
    },
    schemas: {
      Manifest: sent(ManifestSchema),
      ProducedEvent: sent(ProducedEventSchema),
      EventDelivery: received(EventDeliverySchema),
      CreateBusinessTaskRequest: sent(CreateBusinessTaskRequestSchema),
      SubmitSubtaskRequest: sent(SubmitSubtaskRequestSchema),
      SubtaskMessageRequest: sent(SubtaskMessageRequestSchema),
      BusinessTaskDto: received(BusinessTaskDtoSchema),
      SubtaskDto: received(SubtaskDtoSchema),
    },
  };
}

/** 键按字典序、`required`／`enum` 这类标量集合排序：只调换声明顺序不应该让金样变化。 */
function normalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    const items = value.map(normalize);
    return items.every((item) => typeof item === 'string' || typeof item === 'number') ? [...items].sort() : items;
  }
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key]!)]));
}
