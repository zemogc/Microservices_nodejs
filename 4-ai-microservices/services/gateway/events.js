const { PassThrough } = require('stream');

// Server-Sent Events hub. Every write goes through the gateway, so it can tell
// connected browsers about new posts and threads without the services knowing.
// With several gateway instances each one only reaches its own clients; in
// production you would fan out through Redis pub/sub, SNS or similar.
function createEventHub({ heartbeatMs = 25_000 } = {}) {
  const clients = new Set();

  function subscribe(ctx) {
    ctx.req.socket.setTimeout(0);
    ctx.req.socket.setNoDelay(true);
    ctx.set({ 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    ctx.type = 'text/event-stream';
    ctx.status = 200;

    const stream = new PassThrough();
    stream.write(`retry: 3000\n\n`);
    const heartbeat = setInterval(() => stream.write(': ping\n\n'), heartbeatMs);
    clients.add(stream);

    const close = () => {
      clearInterval(heartbeat);
      clients.delete(stream);
    };
    ctx.req.on('close', close);
    stream.on('close', close);
    ctx.body = stream;
  }

  function publish(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) client.write(message);
  }

  return { subscribe, publish, size: () => clients.size };
}

module.exports = { createEventHub };
