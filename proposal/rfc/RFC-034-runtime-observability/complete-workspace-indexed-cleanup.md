# 完整统计规模：原工作区子树清理与验收进展

状态：有限设计审阅 VALID/PASS，实现候选；RFC 仍 In Progress。用户要求完整统计，所有原任务、调用、四类 Token 和人民币估值必须读到明确 EOF，不能缩减人口或将缺失补零。

## 原实际失败

[原 100K/10M hosted 规模验收](https://github.com/wangbinquan/CrewStation/actions/runs/37568494646) 中，单任务一千万条调用的 self-total 通过；十万任务、一千万调用的完整系统/项目报告仍未通过。原种子阶段约 122 分钟，系统构建运行至原 240 分钟作业期限，项目报告尚未开始。原资源样本记录 TEMP 7.94GB、数据库与 TEMP 共 48.7GB；失败、原日志和资源样本均保留。

原 reportWorkspace.clearTree 每个任务都会执行 equality OR left(namespace, length(root)+1)=root+'/'，导致 PostgreSQL 在已包含所有保留记录的 TEMP 表上 Seq Scan。实际原快照与真实 PostgreSQL 的 6000 条保留记录诊断确认四个字面边界案例均走全表扫描，匹配八个子树成员且保留七个相似前缀兄弟。

## 等价修复

原 TEMP 表已为 namespace 与 key 指定 COLLATE C，并建立 PRIMARY KEY(namespace,key)。清理现在匹配精确 root，或 namespace 位于 [root+'/', root+'0')。ASCII slash 的字节 0x2f 与 zero 的 0x30 相邻，区间恰好是所有 slash 后代，保持 Unicode、字面百分号／下划线、引号和末尾 slash 的原行为。实际等价查询用 BitmapOr 和两个原主索引扫描，不增加索引、表或迁移，也不改原快照、任务人口、页游标、明确 EOF 或产品期限。

新真实回归通过 actual workspace 捕获 actual DELETE 的 EXPLAIN，不强制 planner 设置；逐项核对删除的后代、保留的兄弟，并将全部 6000 条背景记录读到 EOF。将本会话唯一清理谓词播种成旧谓词后，原实际回归在 Seq Scan 断言处失败；候选随即精确恢复，其他贡献者输出保持，未启动完整门。原 active、空 namespace、abort 和快照收尾保护另有实际回归。

## 原统计夹具超时

原完整检查的一项统计用例在默认 5000ms 预算中超时；原单项在同一预算内通过只用作诊断，不关闭失败。真实原夹具量化比较发现三个完整报告原紧轮询共 171 次实际 status 读取；等待现有 reportWorkers.drain 的真实完成事件后各读取一次，共 3 次。原系统、开发、单任务、项目／算力名、Token／人民币与 EOF 均一致。夹具只改变等待方式，所有原测试、原断言和 5000ms 预算保持，没有直接构造 ready。

2026-10-07 12:28:51 UTC，在原非生产 PostgreSQL 55335 上，相关原文件及新回归共 26 pass、0 fail、32273 个断言。下一轮共同依赖的唯一完整检查、独立源码复审、精确提交与终态 hosted CI、原 100K/10M/240 分钟规模，以及原生真实任务/正式页面验收分别仍待取证；本目标回归不认证这些开放出口。
