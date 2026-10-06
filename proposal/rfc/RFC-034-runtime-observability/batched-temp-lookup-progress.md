# RFC-034 原 TEMP 批量读取修复与检查记录

本片修复完整选择对每个冷 ancestry／coverage root 单独访问原 PostgreSQL TEMP 的问题。批量查询使用已有原语、同一 snapshot 与原关系，500 个 key 仅为单次运输包；完整输入、所有祖先、四桶与每条 allocation 持续读取到真实 EOF，没有统计人口限制、第二数字账本或预聚合替代。

原 group／model／tree 的 JSON key 字节已提取到纯 helper。原 retainedInput 的 ordinal／count／cursor 检查与外部 localeCompare 排序保持；第一遍 ancestry 验证、第二遍覆盖判定及原 AVL 仍负责完整结果。预取仅合并真实冷 key 读取，4096 cache／500 dirty buffer 仍有界。原 affirmative empty EOF 与第一点读保留，任何 setRoot 撤销 empty 证明；await 期间写入、flush／evict 后的旧缺失不能覆盖实际新路径或 root。

真实原 PostgreSQL 1201 独立 self-total 回归逐条对齐全部 identity 与 allocation EOF，四桶为输入 1201、缓存读取 3603、缓存写入 6005、输出 8407；实际断言 ancestry 点读至多 3、批读确已接入且每包至多 500。521 深度、跨后续输入页的祖先冲突、已知／未知模型、未知桶、同批 summary 更新、缓存淘汰、查询失败、取消与 iterator 关闭都有相关回归。没有调整原 10001 人口、EOF 断言或测试预算。

DESIGN-R1 有效有限 PASS。SOURCE-R1 的 P2 FAIL 保留，修正模块内相对 import 与 awaited 冷 root／ancestry 一致性后，SOURCE-R2 有效 PASS。首次完整 check 的 exit 2 保留：新增 fixture 的 provider 使用了原合同不接受的字符串；只改为真实 model ID 与 provider:null，原场景、人口与断言保持，SOURCE-R3 有效有限 PASS。相关原 PG 回归 25 pass／0 fail、43928 断言，类型修正后的三个实际用例 3 pass／0 fail、3628 断言；这些不替代原规模资格。

改变后的固定九路径只执行一次完整 bun run check：2026-10-06 05:59:39Z 开始，06:33:34Z 结束，exit 0，首末候选字节一致。结构、lint、后端和控制台类型检查均通过；6219 pass、157 原环境 skip、0 fail，289050 断言，6376 tests／1259 files。未把环境 skip 记为实际外部设施通过，也没有因为无关 HEAD 变化重复全量检查。

本片仅九个源码／测试／设计候选、此记录及共享 STATE。保留并排除 dev-session 与 RFC-036 在制输出，STATE 旧全文逐字保持。发布后必须以新确切 SHA 的六项 hosted CI 核对干净提交，再构建该提交镜像并部署本机八组件；尚未发生的部署与 CI 不提前记完成。

旧 `52c8eb74fd8354f15c9f1254106cb38d08b0949d` 的 full-report／self-total 规模 run `37395130449` 双项原 240 分钟 timeout 保留，不算通过。生产修复发布后继续原 100000 Task／10000000 usage 与同组 10000000 self-total、全部独立身份／EOF／四桶、人民币 500 元验收专用估值、100 读样本与 P95 < 500ms、原 OS 资源采样，不缩人口或放宽门槛。

默认 producer OFF、开发 before/final、平台 v2 数字消费者与历史 seal、真实 CLI／算力自测、CS 托管 AW 实际联动及两 RFC 退出条件继续开放。当前不记 RFC Done。
