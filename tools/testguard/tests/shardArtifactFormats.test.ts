// R14 SOURCE found that a closed outer root could conceal an unclosed failure case,
// and DA:1,broken could turn original coverage hits into NaN. Both must fail the complete gate.
import { expect, test } from 'bun:test';
import { parseJunit } from '../junitReport';
import { parseLcov } from '../lcovReport';
import { makeTierShardReceipt, mergeTierShardArtifacts } from '../tierShards';
import { parseShardJunit, validateShardLcov } from '../shardArtifactFormats';

const files = ['a/one.test.ts', 'b/two.test.ts', 'c/three.test.ts', 'd/four.test.ts'];
const input = { tier: 'module' as const, files, commit: 'original', population: 'all-source-files' };
const xml = (paths: readonly string[], extra = ''): string => `<testsuites><testsuite>${paths.map((file) => `<testcase name="original" file="${file}"/>`).join('')}${extra}</testsuite></testsuites>`;
const lcov = 'SF:modules/shared.ts\nDA:1,2\nLF:1\nLH:1\nend_of_record\n';
function original(index: number, junit = xml(index === 1 ? [files[0]!, files[2]!] : [files[1]!, files[3]!]), coverage = lcov) {
  const assigned = index === 1 ? [files[0]!, files[2]!] : [files[1]!, files[3]!];
  return { receipt: JSON.stringify(makeTierShardReceipt({ ...input, shard: { index, total: 2 }, files: assigned, exitCode: 0, junit, lcov: coverage })), junit, lcov: coverage };
}

test('reject the exact hidden unclosed failure even with both assigned passing files and matching receipt digests', () => {
  const report = xml([files[0]!, files[2]!], '<testcase name="hidden failure" file="a/one.test.ts"><failure>original failure</failure>');
  expect(parseJunit(report)).toHaveLength(2);
  expect(() => mergeTierShardArtifacts({ ...input, artifacts: [original(1, report), original(2)] })).toThrow('XML');
});
test('reject the exact malformed numeric DA even with complete records and matching receipt digests', () => {
  const report = 'SF:modules/shared.ts\nDA:1,broken\nend_of_record\n';
  expect(Number.isNaN(parseLcov(report).get('modules/shared.ts')!.get(1))).toBe(true);
  expect(() => mergeTierShardArtifacts({ ...input, artifacts: [original(1, undefined, report), original(2)] })).toThrow('DA');
});
test('complete valid XML preserves entities, CDATA, self-closing empty output and original failed statuses', () => {
  const report = '<?xml version="1.0"?><testsuites><testsuite><testcase name="原用例 &amp; quoted &quot;name&quot;" file="a.ts"><system-out><![CDATA[x < y & literal text]]></system-out></testcase><testcase name="failure" file="b.ts"><failure>original failure</failure></testcase></testsuite></testsuites>';
  expect(parseShardJunit(report)).toHaveLength(2);
  expect(parseJunit(report).map((entry) => entry.status)).toEqual(['passed', 'failed']);
  expect(parseJunit(report)[0]!.name).toBe('原用例 & quoted "name"');
  expect(parseShardJunit('<testsuites/>')).toHaveLength(0);
  expect(() => parseShardJunit('')).toThrow();
  expect(() => parseShardJunit('<other/>')).toThrow('根');
  expect(() => parseShardJunit('<testsuite><testcase><testcase/></testcase></testsuite>')).toThrow('层级');
  expect(() => parseShardJunit('<testsuite><testcase name="&missing;"/></testsuite>')).toThrow('XML');
  expect(parseShardJunit('<testsuites tests="2"><testsuite tests="2"><testcase/><testcase/></testsuite></testsuites>')).toHaveLength(2);
  expect(() => parseShardJunit('<testsuites tests="3"><testsuite tests="2"><testcase/><testcase/></testsuite></testsuites>')).toThrow('遗漏');
  expect(() => parseShardJunit('<testsuite tests="broken"><testcase/></testsuite>')).toThrow('总数');
});
test('CDATA phantom cases are text and retain every real case without adding a phantom', () => {
  const report = xml([files[0]!, files[2]!], '<testcase name="unparsed" file="a/one.test.ts"><system-out><![CDATA[</testcase><testcase name="phantom" file="a/one.test.ts"/>]]></system-out></testcase>');
  expect(parseShardJunit(report)).toHaveLength(3);
  const merged = mergeTierShardArtifacts({ ...input, artifacts: [original(1, report), original(2)] });
  expect(merged.cases).toHaveLength(5);
  expect(merged.cases.map((entry) => entry.name)).not.toContain('phantom');
});
test('complete LCOV retains zero and positive rows, checksums and original function/branch records', () => {
  const report = 'TN:original\nSF:a.ts\nFN:1,original\nFNDA:2,original\nFNF:1\nFNH:1\nDA:1,2,checksum\nDA:2,0\nBRDA:1,0,0,-\nBRF:1\nBRH:0\nLF:2\nLH:1\nend_of_record\n';
  expect(() => validateShardLcov(report)).not.toThrow();
  expect([...parseLcov(report).get('a.ts')!]).toEqual([[1, 2], [2, 0]]);
  expect(() => validateShardLcov('')).not.toThrow();
  expect(() => validateShardLcov('TN:empty\n')).not.toThrow();
});
test('reject invalid or duplicate DA rows and incomplete file records', () => {
  for (const data of ['DA:1,NaN', 'DA:1,-1', 'DA:0,1', 'DA:1,1.5', 'DA:9007199254740993,1', 'DA:1,9007199254740993', 'DA:1,1\nDA:1,2']) expect(() => validateShardLcov(`SF:a.ts\n${data}\nend_of_record\n`)).toThrow('DA');
  for (const report of ['DA:1,1\n', 'end_of_record\n', 'SF:\nend_of_record\n', 'SF:a.ts\n', 'SF:a.ts\nSF:b.ts\nend_of_record\n', 'SF:a.ts\nend_of_record\nSF:a.ts\nend_of_record\n', 'SF:a.ts\ninvalid\nend_of_record\n']) expect(() => validateShardLcov(report)).toThrow();
});
test('the complete original line population and positive hit count must match supplied LF and LH', () => {
  for (const extra of ['LF:2', 'LH:0', 'LF:broken', 'LF:9007199254740993', 'LH:1\nLH:1']) expect(() => validateShardLcov(`SF:a.ts\nDA:1,1\n${extra}\nend_of_record\n`)).toThrow();
});

test('an equally sized regexp extraction cannot hide the actual failure after a CDATA closing tag', () => {
  const report = '<testsuites><testsuite><testcase name="actual failure" file="a/one.test.ts"><system-out><![CDATA[</testcase>]]></system-out><failure>original failure</failure></testcase><testcase name="original" file="c/three.test.ts"/></testsuite></testsuites>';
  expect(parseJunit(report)).toHaveLength(2);
  expect(parseJunit(report).every((entry) => entry.status === 'passed')).toBe(true);
  const actual = parseShardJunit(report);
  expect(actual).toHaveLength(2); expect(actual[0]!.status).toBe('failed');
  expect(() => mergeTierShardArtifacts({ ...input, artifacts: [original(1, report), original(2)] })).toThrow('失败');
});
test('literal failure markup in CDATA is text while actual errors and skips keep original precedence', () => {
  expect(parseShardJunit('<testsuite><testcase><system-out><![CDATA[<failure>text</failure>]]></system-out></testcase></testsuite>')[0]!.status).toBe('passed');
  const report = '<testsuite><testcase><skipped/><error>actual error</error></testcase><testcase><skipped/></testcase></testsuite>';
  expect(parseShardJunit(report).map((entry) => entry.status)).toEqual(['failed', 'skipped']);
  for (const time of ['NaN', '-1', 'Infinity']) expect(() => parseShardJunit(`<testsuite><testcase time="${time}"/></testsuite>`)).toThrow('时间');
});
