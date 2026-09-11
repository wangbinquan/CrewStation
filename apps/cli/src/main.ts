#!/usr/bin/env bun
// crewstation CLI 入口：子命令在 M1（管理员）与 M3（项目成员）加入。
const [command = 'help'] = process.argv.slice(2);
if (command === 'help' || command === '--help') {
  console.log('crewstation <command>\n\n可用命令随里程碑加入；当前只有 help。');
  process.exit(0);
}
console.error(`未知命令：${command}`);
process.exit(2);
