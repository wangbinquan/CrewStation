import { expect, test } from 'bun:test';
import { resumeAfterOperatorExit } from './guardian';

test('a lost operator channel cannot resume Registry until the original operator actually exits', async () => {
  let checks = 0, killed = false; const events: string[] = [];
  await resumeAfterOperatorExit({ alive: async () => ++checks < 4,
    kill: async () => { killed = true; events.push('kill original operator'); },
    resume: async () => { expect(checks).toBe(4); expect(killed).toBe(true); events.push('continue original Registry'); } }, async () => { events.push('wait for actual exit'); });
  expect(events).toEqual(['kill original operator', 'wait for actual exit', 'wait for actual exit', 'continue original Registry']);
});
test('an already exited operator only resumes its original Registry; failed kill never resumes', async () => {
  let resumes = 0;
  await resumeAfterOperatorExit({ alive: async () => false, kill: async () => { throw Error('must not kill'); }, resume: async () => { resumes++; } }); expect(resumes).toBe(1);
  await expect(resumeAfterOperatorExit({ alive: async () => true, kill: async () => { throw Error('original operator cannot exit'); }, resume: async () => { resumes++; } })).rejects.toThrow('cannot exit');
  expect(resumes).toBe(1);
});
