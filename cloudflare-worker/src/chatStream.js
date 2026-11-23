export const CHAT_MODEL = '@cf/meta/llama-3.2-3b-instruct';

export async function streamWorkerChat(ai, messages, meta, headers, detailed = false) {
  const source = await ai.run(CHAT_MODEL, { messages, stream: true, max_tokens: detailed ? 384 : 160 });
  const encoder = new TextEncoder();
  const frame = event => encoder.encode('data: ' + JSON.stringify(event) + '\n\n');
  let buffer = '';
  let received = false;
  let finished = false;
  function consume(line, controller) {
    if (!line.startsWith('data:') || finished) return;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') { finished = true; return; }
    const chunk = JSON.parse(payload);
    if (chunk.error || chunk.errors?.length) throw new Error('Model stream failed');
    if (chunk.response) {
      received = true;
      controller.enqueue(frame({type:'delta', text:chunk.response}));
    }
  }
  const events = source.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream({
    start(controller) { controller.enqueue(frame({type:'meta', ...meta})); },
    transform(chunk, controller) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) consume(line, controller);
    },
    flush(controller) {
      consume(buffer, controller);
      controller.enqueue(frame(received && finished ? {type:'done'} : {type:'error', code:'INCOMPLETE_REPLY', message:'The reply was interrupted. Please try again.'}));
    },
  }));
  return new Response(events, { headers:{...headers,'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store'} });
}
