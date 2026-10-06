# RFC-034 完整选择的原 TEMP 批量读取

本补充修复已批准的完整统计规模问题。原 Task／usage 人口、四桶／人民币、原 EOF、选择顺序与覆盖区间算法不变；不增采样、人口截止、跳过或统计小计。设计与独立功能复核先完成，再实现；原失败不改记通过。

## 原失败和确切阶段

原 52c8eb74fd8354f15c9f1254106cb38d08b0949d 的 hosted run 37395130449，两项作业都达到原四小时预算，未取得完整 PASS。self-total 在00:45:46Z已写完10000000原 TEMP输入，选择截至04:39:43Z仍未完成；原 PG 可见 TEMP 采样最大62667284480bytes。full-report在00:42:58Z完成100000物理父，02:52:26Z完成10000000物理用量，02:54:14Z开始系统报告构建，截至04:41:18Z未完成；原数据库含TEMP采样最大38754951168bytes。原日志与两个资源 artifact 保留，不把CI六项成功当规模成功。

实际源码存在两种每个冷 key 单独往返原连接的读取：completeUsageWorkspace.bindAncestry 对原 group/session 查询 ancestry；completeCoverageWorkspace.root 对四桶、会话/祖先与模型分区查询 root。4096项缓存与500行dirty批次保持有限内存，但大量独立session仍会触发大量点读。现有 getMany 能在同一原 TEMP关系读取一组确切 key。这些源码事实说明可去除冗余往返，尚不构成原失败已定位到某一个查询或新吞吐已通过的实测证明。

## 有限实现范围

只改 observability 内部 domain 的纯key辅助、原 selection 对这些相同key函数的引用、原 TEMP usage／coverage adapter，以及相应真实回归；不增加新平台服务、数据库迁移、第二数值账本、source聚合或执行入口。原 CompleteWorkingRows.getMany、privateReportWorkspace 和正式完整报告装配继续是唯一底座，无可选fallback或provider分叉。

coverage原模型partition与treeKey提取到同模块domain的纯辅助，保持原JSON字节。预取枚举原coverageRelation可能查询的全部四桶、自己/祖先、cover/overlap分区，使用相同key函数；它只改善lookup，不参与覆盖判定或更改rememberSummary。原 prefix maximum／AVL、比较器、自己与tree-total语义、未知模型和未知桶全部保持。

## 原 ancestry 读取

workspace.records继续校验不可变input的每条ordinal、累计数与真实EOF。每个原输入页在yield前，用该页实际record的完整scope路径生成 group/session key，分批调用原getMany。每批完整读取全部请求key；不存在的key只在本次有界缓存内记为undefined，不能推断整张关系为空。祖先深度和总record数量不设截止。

原bindAncestry优先pending写与有界缓存，再退回原point读取；使用Map.has区分已证实缺失与未缓存。它仍对每条完整path比较，重复session的不同祖先仍失败；原pending插入和缓存淘汰规则不变。任何bind写都会更新本workspace的本地变更身份；预取等待期间若已有写入，只弃置本批缓存结果，后续使用原缓存/原点读，不把旧缺失覆盖新路径。该身份不是持久计数或统计数据。

## 原 coverage 读取

原排序器输入继续使用原始records，不为排序重新预取ancestry。orderedRecords只在有界小批真实排序输出yield前预取相应roots，顺序原样保持，原merge顺序断言继续执行；随后处理每条record时即时setRoot/save依旧决定后续record是否被覆盖，不能将预取根当最终判定。

预取首次仍调用原root方法，保留原真正empty EOF与首次point读取；已证明整张root关系为空且尚无setRoot时，不追加无意义的bulk读取。setRoot立即撤销empty证明。其余所需key分批原getMany，完整匹配实际tree身份，并把缺失缓存为原{tree,id:null}；不读取其他namespace或推断未知node为空。root/dirty写始终优先，等待期间发生setRoot时弃置该批预取结果，不恢复旧root。节点读取/写入和原500行flush不变。

预取批次只约束一次原getMany参数包，沿全部输入和所需keys持续到EOF；key暂存、LRU和dirty缓存始终有界。超过一包或缓存容量时继续分批与原point读取，绝不丢弃record、祖先、树、allocation或末页。取消、原连接关闭和实际getMany失败仍传播，不能被当作已知零。

## 功能与规模验收

先写能表现原点读往返的新回归，再实现。原既有空EOF／pending写／4096淘汰、201 Task／1001 attempt、所有选择矩阵及预算逐字保持。新回归包括非覆盖self-total的全部allocation EOF与四桶、同批后来的summary覆盖前置预取缺失、CS原modelRef分区（provider继续固定为null）、深祖先与跨批冲突、缓存淘汰重读、真实TEMP getMany／point次数、预取等待中的本地写入与回滚/关闭/取消/查询失败。测试不只检验辅助函数输出，必须走原selectCompleteUsage与实际完整报告装配。

实现功能门、一次候选完整本机检查、确切SHA的六项CI各自记录。只在生产修复后重跑原固定100000／10000000与独立同组10000000，保持原240分钟、100次读取、P95<500ms、独立identity bitmap、四桶10M/30M/50M/70M、160M Token、人民币500元、首末页与全EOF及真实OS资源测量；不更改种子逻辑、测量算法、数量、skip、retry或已有预算。

本补充不代表默认开发producer、v2消费者、CLI／算力自测、CS→AW真实托管联动或两个RFC已完成；这些退出条件继续。独立门只审功能，不扩展安全工作。

完整本机检查 R1 的 arch/lint 已通过，typecheck 发现新增测试夹具误造 CS 不支持的 provider 字符串；该失败保留。R3 仅将该新夹具改为原 CS modelRef 的 A/B/null，维持原五输入、三 selected、二 excluded、一 ambiguous、四桶与全部 allocation EOF 判据；生产接口及生产候选不变。修订后重新验真实 TEMP 场景与完整候选检查，不能将 R1 记通过。
