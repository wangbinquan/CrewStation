# RFC-034：原生全量 EOF 读取器

这是完整统计设计的读取底座实现，不是 CS 已移除全部统计限制的验收。两个 RFC 继续 In Progress，开发 producer 仍 OFF。

在原 owner 提供的原生 SQLite 文件和接受的 root/lineage/turn/source-generation/epoch 上，建立单个只读快照与连接私有磁盘 TEMP 工作区。session 队列、part 严格 keyset、child 严格 keyset 和跨页未结束 step 检查均读到实际 EOF；session、part、step、祖先深度总数没有上限。父引用独立分页，深树不生成截断祖先数组。页大小仅限制单次 CPU/传输，不限制全量人口；非数值 part 也推进真实游标，只有原查询全部结束才有 EOF。

一个冻结页必须经原 owner ACK 后才继续，重试同页逐字一致，真实 EOF 最后一页也需要 ACK 才关闭快照。完整计数用十进制。Boolean、数组、对象、未知桶均保留未知；output/reasoning 与旧 CS 原归一化语义一致，原模型、时间合法边界不改变。中断、非法键、环、未结束 step、原文件消失不能冒充完整 numeric capture。

新增原物理数据库超过 60002 parts、10001 steps、1025 sessions、深度80，逐条四桶、跨页、丢 ACK/错误 ACK、原快照中途变化、非法空键/环/坏数据及原 counter oracle 对拍。与 AW 已发布 strict keyset 底座同源，但使用实际 CS counter 合同与原 Task 身份。测试基于临时真实数据库，不冒充真实模型任务。

尚待原生顺序侧车/原 before-spawn 完整 baseline 持久页、原 owner emission/high-water/source ACK、平台分页投影、历史补全与生产接线。旧 v1 的 10000 steps、64 ancestry、16MiB 证据与原 ownership drop 限制仍是待移除缺陷，不能以本底座或测试声明已解决。原生命周期、lease/birth/reap/stop 防护不放行。


### 畸形步骤身份的原始证据

原始 SQLite 中的 `step-start` 或 `step-finish` 如果没有有效 `message_id`，读取器在推进该原始行前明确拒绝，并关闭这次快照。空字符串与 SQL NULL 的未完成开始、单独完成及成对开始／完成均有真实数据库回归；不能遗漏开始记录、消掉原有 `native-step-unfinished` 信号，再把无步骤 EOF 解释为零消耗。此处仅修复读取器基础；正式 producer、持久 baseline、owner 发射及 ACK 接线仍待完成。
