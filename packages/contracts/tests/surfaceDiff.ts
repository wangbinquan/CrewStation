import type { ContractSurface, JsonValue, SurfaceDirection } from './contractSurface';

export interface SurfaceDrift {
  /** 既有业务不受影响的变化：新常量、新的可选字段、平台多接受一种取值。 */
  readonly additive: readonly string[];
  /** 可能弄坏既有业务的变化：删、改名、改值、收紧约束、让业务收到它不认识的取值。 */
  readonly breaking: readonly string[];
}

/** 业务发给平台的数据上新增这些关键字，等于平台开始拒绝原先接受的输入。 */
const TIGHTENING = new Set([
  'additionalProperties', 'propertyNames', 'const', 'format', 'pattern',
  'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems',
]);

type Report = (kind: 'additive' | 'breaking', line: string) => void;

export function diffSurface(before: ContractSurface, after: ContractSurface): SurfaceDrift {
  const additive: string[] = [];
  const breaking: string[] = [];
  const report: Report = (kind, line) => { (kind === 'additive' ? additive : breaking).push(line); };
  // 常量没有方向：业务按名字依赖它们，新增无害，删与改都是破坏。
  walk(before.constants as JsonValue, after.constants as JsonValue, 'constants', undefined, report);
  for (const name of new Set([...Object.keys(before.schemas), ...Object.keys(after.schemas)])) {
    const was = before.schemas[name];
    const now = after.schemas[name];
    if (!was) report('additive', `＋ schemas/${name}`);
    else if (!now) report('breaking', `－ schemas/${name}`);
    else if (was.direction !== now.direction) report('breaking', `～ schemas/${name}/direction：${was.direction} → ${now.direction}`);
    else walk(was.schema, now.schema, `schemas/${name}`, now.direction, report);
  }
  return { additive, breaking };
}

function walk(before: JsonValue | undefined, after: JsonValue | undefined, path: string, direction: SurfaceDirection | undefined, report: Report): void {
  if (before === undefined) return report(tightens(path, direction) ? 'breaking' : 'additive', `＋ ${path} = ${show(after)}`);
  if (after === undefined) return report('breaking', `－ ${path}（原值 ${show(before)}）`);
  if (isScalarList(before) && isScalarList(after)) return walkSet(before, after, path, direction, report);
  if (Array.isArray(before) && Array.isArray(after)) {
    for (let index = 0; index < Math.max(before.length, after.length); index += 1) walk(before[index], after[index], `${path}[${index}]`, direction, report);
    return;
  }
  if (isRecord(before) && isRecord(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) walk(before[key], after[key], `${path}/${key}`, direction, report);
    return;
  }
  if (before !== after) report('breaking', `～ ${path}：${show(before)} → ${show(after)}`);
}

function walkSet(before: readonly JsonValue[], after: readonly JsonValue[], path: string, direction: SurfaceDirection | undefined, report: Report): void {
  for (const member of after) {
    if (!before.includes(member)) report(tightens(`${path}{${String(member)}}`, direction) ? 'breaking' : 'additive', `＋ ${path}{${String(member)}}`);
  }
  for (const member of before) {
    if (!after.includes(member)) report('breaking', `－ ${path}{${String(member)}}`);
  }
}

/** 一处「新增」是否其实在收紧：业务要多给东西、平台开始拒收，或业务会收到它不认识的取值。 */
function tightens(path: string, direction: SurfaceDirection | undefined): boolean {
  if (direction === 'business-to-platform') {
    if (/\/required\{[^}]*\}$/.test(path)) return true;
    return TIGHTENING.has(path.slice(path.lastIndexOf('/') + 1));
  }
  if (direction === 'platform-to-business') return /\/(?:enum|type)\{[^}]*\}$/.test(path) || /\/(?:anyOf|oneOf)\[\d+\]$/.test(path);
  return false;
}

const isRecord = (value: JsonValue): value is { [key: string]: JsonValue } => typeof value === 'object' && value !== null && !Array.isArray(value);
const isScalarList = (value: JsonValue): value is JsonValue[] => Array.isArray(value) && value.every((item) => typeof item !== 'object' || item === null);

function show(value: JsonValue | undefined): string {
  const text = JSON.stringify(value) ?? 'undefined';
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

export function describeDrift(drift: SurfaceDrift): string {
  const lines = ['业务契约面与金样不一致（packages/contracts/tests/golden/contractSurface.json）。'];
  if (drift.breaking.length > 0) {
    lines.push('', `破坏性变化 ${drift.breaking.length} 处——已部署的数字人与业务仓库可能因此失效：`, ...drift.breaking.map((line) => `  ${line}`));
    lines.push('', '这类变更要先有作者批准的依据（RFC 的能力影响清单或裁定编号，开发规则 §5.5），再运行：', '  bun run contracts:lock --breaking "<依据>"');
  }
  if (drift.additive.length > 0) {
    lines.push('', `纯新增 ${drift.additive.length} 处：`, ...drift.additive.map((line) => `  ${line}`));
    if (drift.breaking.length === 0) lines.push('', '确认这些新增是有意的，然后运行：', '  bun run contracts:lock');
  }
  return lines.join('\n');
}
