export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

/** 一行一个 JSON 对象，便于集群日志采集；字段名固定为 ts、level、msg 加自定义字段。 */
export function createJsonLogger(base: LogFields = {}, write: (line: string) => void = (line) => console.log(line)): Logger {
  const emit = (level: LogLevel, message: string, fields: LogFields = {}): void => {
    write(JSON.stringify({ ts: new Date().toISOString(), level, msg: message, ...base, ...fields }));
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (fields) => createJsonLogger({ ...base, ...fields }, write),
  };
}

export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => noopLogger,
};
