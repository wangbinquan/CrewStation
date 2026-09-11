// WebSocket 帧、心跳、退避重连与 seq 重放缓冲；与领域无关，供 cs-session 与 TaskRunner 共用。
export type { FrameDecodeReason, FrameSchema, RawFrame } from './frames';
export { FrameDecodeError, decodeFrame, encodeFrame, peekFrameField, rawFrameToText } from './frames';
export type { BackoffPolicy } from './backoff';
export { DEFAULT_BACKOFF, backoffDelayMs } from './backoff';
export type { Heartbeat, HeartbeatOptions, IdleWatchdog } from './heartbeat';
export { createHeartbeat, createIdleWatchdog } from './heartbeat';
export type { ReplayEntry } from './replayBuffer';
export { ReplayBuffer } from './replayBuffer';
export type { ClientState, CloseInfo, ReconnectingClientOptions } from './reconnectingClient';
export { ReconnectingWebSocketClient } from './reconnectingClient';
