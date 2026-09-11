// 交互式常驻流的 stdin 帧。**这一段在 agent-workflow 里没有对应实现**（源只有 one-shot：
// `stdin: {mode:'pipe', data: prompt}` 写一次后立即 end，复制清单 §10 写明「代码的答案是否」）。
//
// 为什么 Claude 能常驻：`claude --help`（本机 2.1.268 实测）有
//   --input-format <format>  Input format (only works with --print): "text" (default),
//                            or "stream-json" (realtime streaming input)
// 即 `-p --input-format stream-json --output-format stream-json --verbose` 下进程不会在
// 第一个 `result` 后退出，而是继续读 stdin 的下一行；stdin EOF 才结束。多轮因此共用**同一个进程**
// 与同一个原生会话，不需要 `--resume`。
//
// 残余风险（已知、登记）：CLI 侧的输入帧形状官方未单独成文（`--input-format` 的说明只有一行），
// 本实现按 Agent SDK 的 `SDKUserMessage` 形状拼帧。M0 原型（Plan T0.4）必须实测确认；
// 若形状不符，回退路径是把 Claude 也改成 opencode 那样的「一轮一进程 ＋ `--resume`」链式模式
// （opencodeAgent 里已经有现成实现）。
//
// OpenCode 侧没有等价能力：`opencode run --help`（本机 1.18.29 实测）的 message 是位置参数，
// 没有任何 stdin 流入口，因此 opencode 的交互式只能链式 one-shot（见 drivers/opencode/driver.ts）。

/** 一帧用户消息；`parent_tool_use_id: null` 表示主对话（非子代理回投）。 */
export function claudeUserMessageFrame(text: string): string {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })}\n`;
}
