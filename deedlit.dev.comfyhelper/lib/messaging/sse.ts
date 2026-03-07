export type SseMessageInput = {
  event?: string;
  data: unknown;
  id?: string;
  retryMs?: number;
};

export function formatSseMessage(input: SseMessageInput): string {
  let output = "";
  if (input.retryMs !== undefined) {
    output += `retry: ${input.retryMs}\n`;
  }
  if (input.id) {
    output += `id: ${input.id}\n`;
  }
  output += `event: ${input.event ?? "message"}\n`;
  output += `data: ${JSON.stringify(input.data)}\n\n`;
  return output;
}

export function createSseSender(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder = new TextEncoder(),
) {
  return (message: SseMessageInput) => {
    controller.enqueue(encoder.encode(formatSseMessage(message)));
  };
}
