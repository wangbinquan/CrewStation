import type { Server } from 'bun';

export type NativeProbeScenario = 'normal' | 'cancel' | 'question' | 'question-reject' | 'permission' | 'api-error';
interface ModelRequest { stream?: boolean; model?: string; tools?: Array<{ name: string }> }

/** 只供原生 CLI 验收：Anthropic 协议夹具，无外部模型调用、无真实模型凭据。 */
export class NativeActivityModel {
  readonly server: Server<undefined>;
  private scenario: NativeProbeScenario = 'normal';
  private usedTool = false;
  private sequence = 0;
  private requested = Promise.withResolvers<void>();

  constructor(private readonly outsideFile: string) {
    this.server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => this.fetch(request) });
  }
  get base(): string { return `http://127.0.0.1:${this.server.port}/v1`; }
  setScenario(scenario: NativeProbeScenario): void { this.scenario = scenario; this.usedTool = false; this.requested = Promise.withResolvers<void>(); }
  whenRequested(): Promise<void> { return this.requested.promise; }
  close(): void { this.server.stop(true); }

  private async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const body = await request.json() as ModelRequest;
    if (path.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 });
    if (!path.endsWith('/messages')) return new Response(null, { status: 404 });
    const scenario = this.scenario;
    if (body.tools?.length) this.requested.resolve();
    if (scenario === 'api-error') return Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'Scripted acceptance failure' } }, { status: 400 });
    if (scenario === 'cancel') await Bun.sleep(7000);
    const name = scenario === 'permission' ? 'read' : 'question';
    const useTool = ['question', 'question-reject', 'permission'].includes(scenario) && !this.usedTool && body.tools?.some((tool) => tool.name === name);
    if (useTool) this.usedTool = true;
    const input = scenario === 'permission' ? { filePath: this.outsideFile } : { questions: [{ question: 'Which acceptance option?', header: 'Probe', options: [{ label: 'Alpha', description: 'First option' }, { label: 'Beta', description: 'Second option' }] }] };
    const sequence = ++this.sequence;
    const content = useTool ? { type: 'tool_use', id: `probe_tool_${sequence}`, name, input } : { type: 'text', text: 'Acceptance response complete.' };
    const message = { id: `probe_message_${sequence}`, type: 'message', role: 'assistant', model: body.model, content: [content], stop_reason: useTool ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
    if (!body.stream) return Response.json(message);
    const events = [
      { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
      { type: 'content_block_start', index: 0, content_block: useTool ? { ...content, input: {} } : { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: useTool ? { type: 'input_json_delta', partial_json: JSON.stringify(input) } : { type: 'text_delta', text: 'Acceptance response complete.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ];
    return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  }
}
