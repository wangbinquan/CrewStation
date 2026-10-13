import type { NativeTerminalStart } from './nativeTerminals';
export interface CliObservationParticipant {
 prepare(start:NativeTerminalStart):Promise<void>;
 dispatch(start:NativeTerminalStart):Promise<boolean>;
 /** The original durable numeric copy must be closed before physical cleanup. */
 end(start:NativeTerminalStart):Promise<boolean>;
}
