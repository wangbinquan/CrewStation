import { SaxesParser } from 'saxes';

import type { CaseStatus, TestCase } from './junitReport';

/** Read every actual XML case and status; text/CDATA cannot terminate a case or hide failure. */
export function parseShardJunit(xml: string): TestCase[] {
  const parser = new SaxesParser({ xmlns: false });
  const stack: { name: string; cases: number; expected?: number }[] = [];
  const cases: TestCase[] = [];
  let current: { name: string; suite: string; file: string; seconds: number; status: CaseStatus } | undefined;
  parser.on('error', () => { throw new Error('分片用例报告未完成或 XML 无效'); });
  parser.on('opentag', (tag) => {
    if (stack.length === 0 && tag.name !== 'testsuite' && tag.name !== 'testsuites') throw new Error('分片用例报告没有原 JUnit 根');
    if (tag.name === 'testcase') {
      if (current || stack.at(-1)?.name !== 'testsuite') throw new Error('分片用例报告的 testcase 层级无效');
      for (const frame of stack) if (frame.name === 'testsuite' || frame.name === 'testsuites') frame.cases++;
      const seconds = Number(tag.attributes.time ?? 0);
      if (!Number.isFinite(seconds) || seconds < 0) throw new Error('分片用例报告的执行时间无效');
      current = { name: tag.attributes.name ?? '', suite: tag.attributes.classname ?? '', file: tag.attributes.file ?? '', seconds, status: 'passed' };
    } else if (current && stack.at(-1)?.name === 'testcase' && (tag.name === 'failure' || tag.name === 'error')) current.status = 'failed';
    else if (current && stack.at(-1)?.name === 'testcase' && tag.name === 'skipped' && current.status !== 'failed') current.status = 'skipped';
    const declared = tag.name === 'testsuite' || tag.name === 'testsuites' ? tag.attributes.tests : undefined;
    const expected = declared === undefined ? undefined : Number(declared);
    if (declared !== undefined && (!/^(0|[1-9]\d*)$/.test(declared) || !Number.isSafeInteger(expected))) throw new Error('分片用例报告的人口总数无效');
    stack.push({ name: tag.name, cases: 0, expected });
  });
  parser.on('closetag', () => {
    const frame = stack.pop()!;
    if (frame.name === 'testcase') { cases.push(current!); current = undefined; }
    if (frame.expected !== undefined && frame.expected !== frame.cases) throw new Error('分片用例报告声明的人口有遗漏');
  });
  parser.write(xml).close();
  return cases;
}

interface LcovRecord { readonly file: string; readonly lines: Map<number, number>; total?: number; covered?: number }

function finishRecord(record: LcovRecord): void {
  if (record.total !== undefined && record.total !== record.lines.size) throw new Error('分片覆盖率 LF 与原行人口不一致');
  if (record.covered !== undefined && record.covered !== [...record.lines.values()].filter((hits) => hits > 0).length) throw new Error('分片覆盖率 LH 与原命中行不一致');
}

/** Preserve the original parser/merge after checking complete SF records and exact numeric DA rows. */
export function validateShardLcov(text: string): void {
  let current: LcovRecord | undefined;
  const files = new Set<string>();
  for (const line of text.split('\n').map((value) => value.replace(/\r$/, ''))) {
    if (!line || line.startsWith('TN:')) continue;
    if (line.startsWith('SF:')) {
      const file = line.slice(3).trim();
      if (current || !file || files.has(file)) throw new Error('分片覆盖率记录未完成、重复或缺少文件');
      files.add(file); current = { file, lines: new Map() }; continue;
    }
    if (!current) throw new Error('分片覆盖率数据没有所属文件');
    if (line === 'end_of_record') { finishRecord(current); current = undefined; continue; }
    if (line.startsWith('DA:')) {
      const match = /^DA:([1-9]\d*),(0|[1-9]\d*)(?:,[^,\s]+)?$/.exec(line);
      const number = Number(match?.[1]); const hits = Number(match?.[2]);
      if (!match || !Number.isSafeInteger(number) || !Number.isSafeInteger(hits) || current.lines.has(number)) throw new Error('分片覆盖率 DA 必须是唯一原行和有效命中数');
      current.lines.set(number, hits); continue;
    }
    if (/^(LF|LH):/.test(line)) {
      const match = /^(LF|LH):(0|[1-9]\d*)$/.exec(line);
      const count = Number(match?.[2]);
      if (!match || !Number.isSafeInteger(count)) throw new Error('分片覆盖率行总数无效');
      const key = match[1] === 'LF' ? 'total' : 'covered';
      if (current[key] !== undefined) throw new Error('分片覆盖率行总数重复');
      current[key] = count; continue;
    }
    if (!/^(?:FN:\d+,(?:\d+,)?.*|FNDA:\d+,.*|(?:FNF|FNH|BRF|BRH):\d+|BRDA:\d+,\d+,\d+,(?:\d+|-))$/.test(line)) throw new Error('分片覆盖率包含无效记录');
  }
  if (current) throw new Error('分片覆盖率报告未完成');
}
