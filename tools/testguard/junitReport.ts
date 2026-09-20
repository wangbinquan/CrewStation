export type CaseStatus = 'passed' | 'failed' | 'skipped';

export interface TestCase {
  readonly name: string;
  /** 所在 describe；顶层用例为空串。 */
  readonly suite: string;
  readonly file: string;
  readonly seconds: number;
  readonly status: CaseStatus;
}

const CASE_RE = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
const ATTR_RE = /([\w:-]+)="([^"]*)"/g;
const ENTITIES: Readonly<Record<string, string>> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };

/** 解析 `bun test --reporter=junit` 的输出。只取 testcase：describe 的嵌套层级已经在每条用例的 classname 里。 */
export function parseJunit(xml: string): TestCase[] {
  const cases: TestCase[] = [];
  for (const match of xml.matchAll(CASE_RE)) {
    const attrs = attributesOf(match[1] ?? '');
    const body = match[2] ?? '';
    const status: CaseStatus = /<(failure|error)\b/.test(body) ? 'failed' : /<skipped\b/.test(body) ? 'skipped' : 'passed';
    cases.push({ name: attrs.get('name') ?? '', suite: attrs.get('classname') ?? '', file: attrs.get('file') ?? '', seconds: Number(attrs.get('time') ?? 0), status });
  }
  return cases;
}

function attributesOf(raw: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const match of raw.matchAll(ATTR_RE)) attrs.set(match[1]!, unescapeXml(match[2] ?? ''));
  return attrs;
}

function unescapeXml(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity] ?? entity).replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

/** 用例归属的区域：工作区单元取两段（modules/identity），其余取顶层目录（tests、deploy）。 */
export function areaOf(file: string): string {
  const parts = file.split('/');
  return ['apps', 'modules', 'packages', 'runtimes', 'tools', 'integrations', 'templates'].includes(parts[0] ?? '') && parts.length > 1 ? `${parts[0]}/${parts[1]}` : (parts[0] ?? file);
}

export const titleOf = (testCase: TestCase): string => (testCase.suite ? `${testCase.suite} › ${testCase.name}` : testCase.name);
