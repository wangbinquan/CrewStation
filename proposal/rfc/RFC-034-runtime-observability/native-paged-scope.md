# N3 原数组与分页父链的混合资格

本片仍使用原唯一 usage ledger。旧 scope、公开业务协议、原 JSON ancestor 绑定及覆盖键保持；开发 v2 的内部 scope 引用实际 final pass、原页与任意精度 depth，不伪造空 ancestors。

原 complete selector 在分配任何桶前读取全部原输入到 EOF。旧记录继续逐前缀绑定原完整 JSON ancestor 路径；新记录从同一报告 snapshot 的原 PG pass/path 引用读取全部父链，逐边检查 depth、parent、root、namespace 和流式 path digest，并在派生 TEMP 内保留常量大小的关系。没有整树 JS Map、深度或总体停止条件。

两种路径指纹的形式不同，不能直接把旧 JSON 路径与原生流式 hash 相比。原 JSON 绑定不改写。全部输入到 EOF 后，对每个原生派生绑定查找同 group/session 的旧路径；旧路径存在时，按已验证的原生 source namespace 流式计算其原字节路径 digest，再与同一真实原生关系核对。这样根/中间父/叶的交叉冲突都在分配前失败，原旧 JSON 内容保留。只在这个实际混合资格步骤计算兼容指纹，不形成新的数字或金额表。

原四桶 AVL selection、model partition 和 interval key 保持。新记录的覆盖查询由同一已核对父链提供完整 AsyncIterable，自身及所有原父都会访问；cache prefetch 对新记录只预读自身，缓存未命中继续走原真实关系读取，不能据此结束父链或缩小统计。全 legacy 人口继续原完整预读路径。

native scope 单独按任意精度 depth 排序；两条 legacy scope 之间保持原 comparator 的返回值和顺序。旧内存 selector 遇到 native scope 明确要求完整 workspace，不丢弃该记录或按空 ancestors 计算。正式 complete report 使用新能力；v1 的公开观测媒体不接受或转换 paged-native 记录。

验收覆盖：超过64深度、1201原步骤、cache淘汰/真实EOF、父晚到、混合根/中间路径冲突、不同 namespace、改变 depth/path/pass/page/owner、完整与缺父、同一原模型分区的根汇总去重，以及所有原 legacy 四桶/CNY/排序回归。本片仅接通内部分页范围和完整父链选择；数字归并、baseline／历史归属、正式 producer 与部署继续，当前 producer OFF。相关新用例与全部既有回归的实跑结果另列，不提前记通过。

## 固定候选完整检查（2026-10-07）

N3 内部分页 scope 与完整父链 workspace 已完成，和部分 CNY／静默刷新组合的同一固定候选执行一次 `bun run check`，正式 PASS：6,327 pass、157 原环境 skip、0 fail，345,197 断言、1,288 文件，测试 2,396.71 秒。38 个候选文件及 11 个原控制在开始／结束保持相同字节；专用非生产 PG，production database 未使用。

原 75／0 定向、真实 1,201 步／71 会话／70 层及旧格式互操作核验保留。此前旧 N3 完整检查的两个原预算超时仍为 FAIL；未加超时、未缩人口，本次因部分 CNY 与实际刷新源内容变化形成新候选，未重复同一个候选的完整门。当前 producer 仍 OFF，N4 数值归属／历史修订、N5 live／删除恢复与 N6 真实开发任务仍开放。确切 SHA CI 与本机部署另验，不能用本机 PASS 代签。
